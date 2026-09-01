// Publishing-platform adapter - a real boundary, not a fake one.
//
// Expected per-platform credential env var names (documented here; none of
// these credentials exist anywhere in this project's environments today):
//   instagram               -> INSTAGRAM_ACCESS_TOKEN
//   facebook                -> FACEBOOK_PAGE_ACCESS_TOKEN
//   google_business_profile -> GOOGLE_BUSINESS_PROFILE_OAUTH_TOKEN
//   tiktok                  -> TIKTOK_ACCESS_TOKEN
//
// manual_export needs no credential at all - it is always "available" because
// it never calls an external API. It returns a structured export package
// (caption + asset URL + platform + suggested post time) for a human to post
// by hand, and that package IS the complete, real result of "publishing" to
// manual_export.
//
// For every real platform, if the credential env var is absent (always true
// today) this returns an honest {status:'failed', failureCode:'platform_not_connected'}
// immediately - no network call, no fabricated success. If a credential were
// ever configured, the call sites below are CLEARLY LABELED PLACEHOLDERS only
// (this project has never verified an actual request shape against
// Instagram/Facebook Graph API, Google Business Profile API, or TikTok's
// Content Posting API) and must be checked against each platform's current,
// real API documentation before any first real use.
const CREDENTIAL_ENV_VAR = {
  instagram: 'INSTAGRAM_ACCESS_TOKEN',
  facebook: 'FACEBOOK_PAGE_ACCESS_TOKEN',
  google_business_profile: 'GOOGLE_BUSINESS_PROFILE_OAUTH_TOKEN',
  tiktok: 'TIKTOK_ACCESS_TOKEN',
};

export async function publishToplatform(platform, env, { account, variant } = {}) {
  if (platform === 'manual_export') {
    return {
      status: 'published',
      exportPackage: {
        platform: 'manual_export',
        caption: (variant && variant.caption) || '',
        hashtags: (variant && variant.hashtags) || [],
        assetUrl: (variant && variant.assetUrl) || null,
        suggestedPostTime: (variant && variant.suggestedPostTime) || null,
      },
    };
  }

  const envVarName = CREDENTIAL_ENV_VAR[platform];
  if (!envVarName) {
    return { status: 'failed', failureCode: 'unsupported_platform', failureMessage: `${platform} is not a supported publishing platform.` };
  }

  const credential = env && env[envVarName];
  if (!credential || !account || account.connection_status !== 'connected') {
    return {
      status: 'failed',
      failureCode: 'platform_not_connected',
      failureMessage: `${platform} has no connected publishing account (expects env var ${envVarName}).`,
    };
  }

  // --- UNVERIFIED PLACEHOLDER BELOW - confirm against each platform's real API docs first ---
  // This branch is unreachable in every environment this project currently
  // runs in, since no platform credential is ever configured. It exists only
  // to make the intended future shape explicit and honest about its own
  // unverified status, not to claim a working integration.
  return {
    status: 'failed',
    failureCode: 'platform_not_connected',
    failureMessage: `${platform} publish is not implemented against a verified real API yet.`,
  };
}
