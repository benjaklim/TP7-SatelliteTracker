const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// with-short-cxx-staging';

/**
 * Windows build workaround: CMake object paths for the app's codegen modules
 * repeat the absolute project path and exceed MAX_PATH (260). When the
 * ANDROID_CXX_STAGING env var is set (e.g. C:\cx), the app's native build
 * staging directory moves there. No effect on other machines.
 */
module.exports = function withShortCxxStaging(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes(MARKER)) return mod;
    mod.modResults.contents = mod.modResults.contents.replace(
      /android\s*\{/,
      `android {
    ${MARKER}
    if (System.getenv('ANDROID_CXX_STAGING')) {
        externalNativeBuild {
            cmake {
                buildStagingDirectory = file(System.getenv('ANDROID_CXX_STAGING'))
            }
        }
    }`,
    );
    return mod;
  });
};
