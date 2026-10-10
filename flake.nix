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
    # gritlint, built and gated by its own repository at the locked commit.
    # Its nixpkgs is not followed: gritlint's CI proved the build against its
    # own lock. Only the `gritlint` package and the dev shell reference it.
    gritlint.url = "github:systemfsoftware/gritlint";
    # `repo-checks`. Only that package references this input, so building
    # any other package never fetches it.
    systemfsoftware.url = "github:systemfsoftware/systemfsoftware";
    # One `pnpm pack` tarball per workspace package, built offline from the
    # lockfile by the same builder systemfsoftware uses.
    pnpm-release-management = {
      url = "github:systemfsoftware/pnpm-release-management";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # This repository at the commit of its latest release, `@systemfsoftware/stryker-js@v18.1.0`.
    # The packages the workspace dogfoods (the mutation CLI, its runner,
    # checker and ignorers) come from its tarballs, never from a registry.
    # Nothing follows: its own lock reproduces the released tarballs byte for
    # byte, the integrity each release tag records.
    stryker-published.url = "github:systemfsoftware/stryker-js-effect/27b1075905a6c69e74eff163567ac25dd4839a1b";
  };

  outputs = { self, nixpkgs, comment-checker, importPnpmLock, gritlint, systemfsoftware, pnpm-release-management, stryker-published }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = fn: nixpkgs.lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});
      # Every tarball the release produced, renamed to `<name without scope>.tgz`
      # so the `file:` paths in the manifests and the lockfile keep their
      # spelling across releases; only their integrity moves.
      publishedOf = pkgs:
        let
          released = stryker-published.packages.${pkgs.stdenv.hostPlatform.system}.workspace-tarballs;
        in
        pkgs.runCommand "stryker-published" { nativeBuildInputs = [ pkgs.jq ]; } ''
          mkdir -p "$out"
          jq -r '.[] | "\(.name | split("/") | last) \(.file)"' ${released}/index.json |
            while read -r name file; do cp ${released}/"$file" "$out/$name.tgz"; done
        '';
      workspaceOf = pkgs:
        pnpm-release-management.lib.mkPnpmWorkspacePackages {
          inherit pkgs;
          src = self;
          pname = "stryker-js-effect";
          pnpm = pkgs.pnpm_11;
          files.".sfs-deps" = publishedOf pkgs;
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
            stryker-published = publishedOf pkgs;
            deno = pkgs.deno;
            comment-checker = sandboxed;
            comment-checker-unwrapped = unwrapped;
            # The bwrap-sandboxed upstream `gritlint` needs unprivileged user
            # namespaces, which Ubuntu 24.04 runners refuse without a workflow
            # step this repo's read-only workflows cannot add.
            gritlint = gritlint.packages.${pkgs.stdenv.hostPlatform.system}.gritlint-unwrapped;
            # Repository invariants for any pnpm workspace; `pnpm gate:repo` and
            # `.husky/pre-push` run its `single-plan` check.
            repo-checks = systemfsoftware.packages.${pkgs.stdenv.hostPlatform.system}.repo-checks;
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
            # The lockfile names the released tarballs under `.sfs-deps/`. They
            # are copied, not linked: the sandbox cannot read a store path
            # outside its own closure.
            shellHook = ''
              sfs_deps="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.sfs-deps"
              rm -rf "$sfs_deps" && mkdir -p "$sfs_deps"
              cp ${self.packages.${system}.stryker-published}/*.tgz "$sfs_deps"/
              chmod u+w "$sfs_deps"/*.tgz
            '';
          };
        });
    };
}
