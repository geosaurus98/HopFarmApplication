// Which server the app uses by default, depending on where it is opened.
//
//  LIVE app  (the workers' address, built from the `main` branch)  → LIVE server
//  TEST app  (any other address: test branch deploys, previews, this computer)
//            → TEST server, and an orange "TEST VERSION" bar on every screen.
//
// The test app never defaults to the live server, so testing can't touch the
// real data by accident.

/** Addresses where the workers' (live) app is served. Add a custom domain here if you set one up. */
export const LIVE_HOSTS = ['peppy-pie-7f7463.netlify.app'];

/** Live server: the Apps Script deployment attached to the real Hop Farm Data sheet. */
export const LIVE_API_URL = 'https://script.google.com/macros/s/AKfycbxMkGICFRtKopeH2SK4jMVYpHJdedSKOaAWREMt3El9mJVODePt-fgsnyxD1XycFy-X/exec';

/** Test server: the deployment attached to the TEST copy of Hop Farm Data. Paste it here once it exists. */
export const TEST_API_URL = 'https://script.google.com/macros/s/AKfycbxtDAsdKCXoHvVUnVu6q0rs2_h2Tnsvcv_KRPWCHd4WCHPQPyWEXIjZADrQ_o0ScDpx4A/exec';

/**
 * Server addresses that have been replaced. A tablet still set up with one of these
 * is moved to the current server when the app starts.
 */
export const PREVIOUS_API_URLS = [
  'https://script.google.com/macros/s/AKfycbwkXZ17Ys7zf23x1uBdeAzZ7BaeWToQtLFm_Ywdac_A1MEtvXP3ZEwfLgJ_k-9pu0tb/exec',
];

/**
 * Servers that moved with their sheets (e.g. to another Google account): old address → new address.
 * The Users & Setup sheet (with its list of set-up tablets) moved too, so tablets keep
 * working: they just switch address, and anything waiting to upload goes to the new server.
 */
export const MOVED_API_URLS = {
  // TEST server, moved to the work Google account
  'https://script.google.com/macros/s/AKfycbx6ojOrv1lPdKdeVw7OCHY40o1dKSNzBeWqSHyfBH6NXWET0BPxNMhxtZYR6QUhqX7FQw/exec':
    'https://script.google.com/macros/s/AKfycbxtDAsdKCXoHvVUnVu6q0rs2_h2Tnsvcv_KRPWCHd4WCHPQPyWEXIjZADrQ_o0ScDpx4A/exec',
};

export const IS_LIVE_APP = typeof location !== 'undefined' && LIVE_HOSTS.includes(location.hostname);

/** Default server address shown on the sign-in screen (people can still type another). */
export const DEFAULT_API_URL = IS_LIVE_APP ? LIVE_API_URL : TEST_API_URL;

export const APP_VERSION = '1.6.1';
