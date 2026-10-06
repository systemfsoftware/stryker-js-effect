{
  description = "the formatter and runtimes the stryker-js-effect check chain shells out to";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # The release manifest (`nix/release-hashes.json`) rides in this input, so
    # Dependabot's bump of it is also the version and digest bump.
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
    # gritlint, compiled from source at the locked commit. Its nixpkgs is not
    # followed: the crate vendor hash is fixed against upstream's own lock.
    # Only the `gritlint` package and the dev shell reference this input, so
    # building any other package never fetches it.
    systemfsoftware.url = "github:systemfsoftware/systemfsoftware";
    # One `pnpm pack` tarball per workspace package, built offline from the
    # lockfile by the same builder systemfsoftware uses.
    pnpm-release-management = {
      url = "github:systemfsoftware/pnpm-release-management/54629f2889039eb2e53ccf0179aaf8c7ef0c46a3";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, comment-checker, importPnpmLock, systemfsoftware, pnpm-release-management }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
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
          unwrapped = pkgs.callPackage ./nix/comment-checker.nix {
            hashes = "${comment-checker}/nix/release-hashes.json";
          };
          sandboxed = pkgs.callPackage ./nix/comment-checker-sandbox.nix {
            comment-checker = unwrapped;
          };
          workspace = workspaceOf pkgs;
          own = {
            inherit dprint;
            deno = pkgs.deno;
            comment-checker = sandboxed;
            comment-checker-unwrapped = unwrapped;
            # The bwrap-sandboxed upstream `gritlint` needs unprivileged user
            # namespaces, which Ubuntu 24.04 runners refuse without a workflow
            # step this repo's read-only workflows cannot add.
            gritlint = systemfsoftware.packages.${pkgs.stdenv.hostPlatform.system}.gritlint-unwrapped;
            default = dprint;
          };
          clashes = builtins.attrNames (builtins.intersectAttrs own workspace);
        in
        assert clashes == [ ] || throw "flake.nix: workspace packages ${lib.concatStringsSep ", " clashes} collide with flake packages";
        workspace // own);

      # pnpm is deliberately absent: `packageManager` pins pnpm@11.27.0 and
      # corepack is the one thing allowed to resolve it. A second pnpm on PATH
      # would answer `pnpm install` with a version the lockfile never saw.
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            self.packages.${pkgs.stdenv.hostPlatform.system}.dprint
            self.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker
            self.packages.${pkgs.stdenv.hostPlatform.system}.gritlint
            pkgs.nodejs_24
            pkgs.deno
            pkgs.process-compose
          ];
        };
      });
    };
}
