{
  lib,
  stdenvNoCC,
  nodejs_24,
  pnpm_11,
  iplConfigHook,
  makeWrapper,
  src,
  mitmCache,
  deps,
}:
let
  composition = "@systemfsoftware/stryker-package";
  cli = lib.importJSON (src + "/packages/stryker-js/package.json");
in
stdenvNoCC.mkDerivation {
  pname = "stryker";
  inherit (cli) version;
  inherit src mitmCache;

  postPatch = ''
    mkdir -p .deps
    cp -r ${deps}/. .deps/
    cat >> pnpm-workspace.yaml <<'YAML'
    supportedArchitectures:
      os: [current]
      cpu: [current]
      libc: [glibc, musl]
    YAML
  '';
  prePnpmInstall = ''
    export NODE_EXTRA_CA_CERTS="$MITM_CACHE_CA"
  '';
  pnpm_config_manage_package_manager_versions = "false";

  nativeBuildInputs = [ nodejs_24 pnpm_11 iplConfigHook makeWrapper ];

  buildPhase = ''
    runHook preBuild
    pnpm --recursive --if-present --filter ${lib.escapeShellArg "${composition}..."} run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    pnpm --filter ${lib.escapeShellArg composition} deploy --prod --offline --store-dir="$(pnpm store path)" --config.node-linker=hoisted "$out/lib"
    makeWrapper ${lib.getExe nodejs_24} "$out/bin/stryker" \
      --add-flags "$out/lib/node_modules/@systemfsoftware/stryker-js/dist/main.mjs"
    runHook postInstall
  '';

  meta = {
    description = "StrykerJS for Effect: the stryker CLI with its vitest runner, TypeScript checker and Effect ignorers";
    homepage = "https://github.com/systemfsoftware/stryker-js-effect";
    license = lib.licenses.asl20;
    mainProgram = "stryker";
    platforms = [ "x86_64-linux" "aarch64-linux" ];
  };
}
