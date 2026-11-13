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
    # `repo-checks`. Only that package references this input, so building
    # any other package never fetches it.
    systemfsoftware.url = "github:systemfsoftware/systemfsoftware";
    # The producers of the e2e harness's microVM packages, at their release commits:
    # `@systemfsoftware/effect-cell-types` 12.1.3 (systemfsoftware, as `core`),
    # `@systemfsoftware/effect-microsandbox` 6.1.0 and `@systemfsoftware/effect-readiness` 1.1.2.
    core.url = "github:systemfsoftware/systemfsoftware/3ef6c21c36f19a539078b6817b495df3039cc163";
    effect-microvm.url = "github:systemfsoftware/effect-microvm/6242c4c039c0203b5749e12f0af013e895407f2f";
    effect-readiness.url = "github:systemfsoftware/effect-readiness/6e094361a2f7a706a2191bab83036ebf107d6ffc";
    # One `pnpm pack` tarball per workspace package, built offline from the
    # lockfile by the same builder systemfsoftware uses.
    pnpm-release-management = {
      url = "github:systemfsoftware/pnpm-release-management";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # This repository at the commit of its latest release, `@systemfsoftware/stryker-js@v20.0.0`
    # (b11828050b15d23bdbfb78c11bfe294956914272).
    # The packages the workspace dogfoods (the mutation CLI, its runner,
    # checker and ignorers) come from its tarballs, never from a registry.
    # Nothing follows: its own lock reproduces the released tarballs byte for
    # byte, the integrity each release tag records.
    stryker-published.url = "github:systemfsoftware/stryker-js-effect/b11828050b15d23bdbfb78c11bfe294956914272";
  };

  outputs = { self, nixpkgs, comment-checker, importPnpmLock, gritlint, systemfsoftware, pnpm-release-management, stryker-published, core, effect-microvm, effect-readiness }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = fn: nixpkgs.lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});
      # The tarballs of the latest release, as `<attr>.tgz` under `.deps/`.
      producerTarballsOf = pkgs: pnpm-release-management.lib.mkProducerTarballs {
        inherit pkgs;
        producers = { inherit stryker-published core effect-microvm effect-readiness; };
      };
      workspaceOf = pkgs:
        pnpm-release-management.lib.mkPnpmWorkspacePackages {
          inherit pkgs;
          src = self;
          pname = "stryker-js-effect";
          pnpm = pkgs.pnpm_11;
          files.".deps" = producerTarballsOf pkgs;
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
            stryker-published = producerTarballsOf pkgs;
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
            # The lockfile names the producer tarballs under `.deps/`. The hook copies
            # them in as real files: the sandbox cannot read a store path outside its
            # own closure.
            shellHook = self.packages.${system}.stryker-published.shellHook;
          };
        });
    };
}
