{
  description = "Development environment for atlas";
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };
  outputs = {nixpkgs, ...}: let
    eachSupportedSystem = f:
      nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
        system:
          f {
            pkgs = import nixpkgs {inherit system;};
          }
      );
  in {
    packages = eachSupportedSystem ({pkgs}: rec {
      viewer = pkgs.stdenv.mkDerivation (finalAttrs: {
        pname = "atlas-viewer";
        version = (builtins.fromJSON (builtins.readFile ./packages/atlas-web/package.json)).version;
        src = ./.;

        pnpmWorkspaces = ["atlas-web..."];
        pnpmDeps = pkgs.fetchPnpmDeps {
          inherit (finalAttrs) pname version src pnpmWorkspaces;
          pnpm = pkgs.pnpm_12;
          fetcherVersion = 5;
          hash = "sha256-+ZgyDXVIhhjMMuKXc3V5HJo2p/hKpYGHmiYJWGj5FpQ=";
        };

        nativeBuildInputs = with pkgs; [
          nodejs_26
          pnpm_12
          pnpmConfigHook
        ];

        buildPhase = ''
          runHook preBuild
          pnpm --filter atlas-web build
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          cp -r packages/atlas-web/dist $out
          runHook postInstall
        '';
      });

      default = pkgs.stdenv.mkDerivation (finalAttrs: {
        pname = "atlas";
        version = (builtins.fromJSON (builtins.readFile ./packages/atlas/package.json)).version;
        src = ./.;

        pnpmWorkspaces = ["atlas"];
        pnpmInstallFlags = ["--prod"];
        pnpmDeps = pkgs.fetchPnpmDeps {
          inherit (finalAttrs) pname version src pnpmWorkspaces pnpmInstallFlags;
          pnpm = pkgs.pnpm_12;
          fetcherVersion = 5;
          hash = "sha256-qKNh8BN3Tkwv9GKEYmV2W5UGIcTcOvQb50ihwoetcVw=";
        };

        nativeBuildInputs = with pkgs; [
          nodejs_26
          pnpm_12
          pnpmConfigHook
          makeWrapper
        ];

        dontBuild = true;

        installPhase = ''
          runHook preInstall
          mkdir -p $out/lib/atlas/packages/atlas-web
          cp -r node_modules $out/lib/atlas/
          cp -r packages/atlas $out/lib/atlas/packages/
          cp -r ${viewer} $out/lib/atlas/packages/atlas-web/dist
          makeWrapper ${pkgs.nodejs_26}/bin/node $out/bin/atlas \
            --add-flags $out/lib/atlas/packages/atlas/src/index.ts \
            --prefix PATH : ${pkgs.git}/bin
          runHook postInstall
        '';

        meta.mainProgram = "atlas";
      });
    });

    devShells = eachSupportedSystem ({pkgs}: {
      default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_26
          pnpm_12
          turbo
          ripgrep
          jq
        ];

        env = {
          pnpm_config_update_notifier = "false";
          pnpm_config_pm_on_fail = "ignore";
          TURBO_TELEMETRY_DISABLED = "1";
        };

        shellHook = ''
          if [ ! -d node_modules ] || {
            [ -f pnpm-lock.yaml ] && [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]
          }; then
            echo "warn: Dependencies may be out of date. Run 'pnpm i' to update."
          fi
        '';
      };
    });
    formatter = eachSupportedSystem ({pkgs}: pkgs.alejandra);
  };
}
