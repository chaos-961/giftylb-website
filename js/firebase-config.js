/* Gifty. Client configuration.
   This file is public by design. The apiKey here is a project identifier, not a
   credential, and it is meant to ship in the bundle. Access is controlled by the
   security rules and by App Check, never by hiding this object.
   Real secrets (the image host key, the mail key, the Turnstile secret) live
   only in Wrangler secrets and never appear in this repo.

   The SDK is not loaded here. Routes that need data load it themselves so the
   homepage pays nothing for it. */

window.GIFTY_CONFIG = {
  apiKey: 'REPLACE_ME_API_KEY',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.firebasestorage.app',
  messagingSenderId: 'REPLACE_ME_SENDER_ID',
  appId: 'REPLACE_ME_APP_ID'
};

/* Endpoint for the one worker that handles uploads, orders and order lookup.
   Wired up in P4. */
window.GIFTY_API = 'https://api.giftylb.com';
