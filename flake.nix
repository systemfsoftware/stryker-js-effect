{
  description = "the formatter and runtimes the stryker-js-effect check chain shells out to";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    comment-checker = {
      url = "github:systemfsoftware/comment-checker";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Hashless pnpm store: each lockfile integrity is the fetch hash.
    # fetchPnpmDeps needs a second store-wide hash that Dependabot cannot update.
    # A package built from this workspace takes this overlay to get
    # `importPnpmLock` and `iplConfigHook` into its `callPackage` arguments.
    importPnpmLock = {
      url = "github:Scrumplex/importPnpmLock.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # gritlint, built and gated by its own repository at the locked commit.
    # Its nixpkgs is not followed: gritlint's CI proved the build against its
    # own lock. Only the `gritlint` package and the dev shell reference it.
    gritlint.url = "github:systemfsoftware/gritlint";
    # One `pnpm pack` tarball per workspace package, built offline from the
    # lockfile by the same builder systemfsoftware uses.
    pnpm-release-management = {
      url = "github:systemfsoftware/pnpm-release-management";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, comment-checker, importPnpmLock, gritlint, pnpm-release-management }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = fn: nixpkgs.lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});
      workspaceOf = pkgs:
        pnpm-release-management.lib.mkPnpmWorkspacePackages {
          inherit pkgs;
          src = self;
          pname = "stryker-js-effect";
          pnpm = pkgs.pnpm_11;
        };
    in
    {
      packages = forEachSystem (pkgs:
        let
          pkgs' = pkgs.extend importPnpmLock.overlays.default;
          dprint = pkgs.callPackage ./nix/dprint.nix { };
          unwrapped = comment-checker.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker;
          sandboxed = pkgs.callPackage ./nix/comment-checker-sandbox.nix {
            comment-checker = unwrapped;
          };
          workspace = workspaceOf pkgs;
          own = {
            inherit dprint;
            stryker = pkgs.callPackage ./nix/stryker.nix {
              inherit (importPnpmLock.legacyPackages.${pkgs.stdenv.hostPlatform.system}) iplConfigHook;
              inherit (workspace) mitmCache;
              src = self;
            };
            deno = pkgs.deno;
            comment-checker = sandboxed;
            comment-checker-unwrapped = unwrapped;
            # The bwrap-sandboxed upstream `gritlint` needs unprivileged user
            # namespaces, which Ubuntu 24.04 runners refuse without a workflow
            # step this repo's read-only workflows cannot add.
            gritlint = gritlint.packages.${pkgs.stdenv.hostPlatform.system}.gritlint-unwrapped;
            default = dprint;
          };
          clashes = builtins.attrNames (builtins.intersectAttrs own workspace);
        in
        assert clashes == [ ] || throw "flake.nix: workspace packages ${lib.concatStringsSep ", " clashes} collide with flake packages";
        workspace // own);

      # pnpm_11 is the pnpm `workspaceOf` builds with, and mkPnpmWorkspacePackages
      # fails evaluation unless `packageManager` pins that exact version, so the
      # shell's pnpm is the pinned one. The reusable release workflow needs it:
      # its workspace reader spawns `pnpm ls` and `pnpm config get`.
      devShells = forEachSystem (pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
        in
        {
          default = pkgs.mkShell {
            packages = [
              self.packages.${system}.dprint
              self.packages.${system}.comment-checker
              self.packages.${system}.gritlint
              pkgs.nodejs_24
              pkgs.deno
              pkgs.process-compose
              pkgs.pnpm_11
              # version-management and github-release-management, which the
              # reusable release workflow runs through `nix develop --command`
              pnpm-release-management.packages.${system}.release-tools
              # The changeset check (`devshell: true`) runs inside it
              pnpm-release-management.packages.${system}.sandbox
            ];
          };
        });
    };
}
