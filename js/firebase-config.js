/* Gifty. Client configuration.
   This file is public by design. The apiKey here is a project identifier, not a
   credential, and it is meant to ship in the bundle. Access is controlled by the
   security rules and by App Check, never by hiding this object.
   Real secrets (the image host key, the mail key, the Turnstile secret) live
   only in Wrangler secrets and never appear in this repo.

   The SDK is not loaded here. Routes that need data load it themselves so the
   homepage pays nothing for it. */

window.GIFTY_CONFIG = {
  apiKey: 'AIzaSyDgiZPH8bepbib5k3AmfS8YX8jY_RZRTos',
  authDomain: 'giftylb.firebaseapp.com',
  projectId: 'giftylb',
  storageBucket: 'giftylb.firebasestorage.app',
  messagingSenderId: '1069350194171',
  appId: '1:1069350194171:web:cb488db6aae5d2bc18595e'
};

/* storageBucket is present because the console hands it over, but nothing uses
   it. Cloud Storage left the Spark plan on 2026-02-03, which is the whole
   reason customer uploads go to an image host through a worker instead. */

/* Endpoint for the one worker that handles uploads, orders and order lookup. */
window.GIFTY_API = 'https://api.giftylb.com';

/* Turnstile's site key is public by design, the same way the config above is.
   Its secret half lives only in Wrangler. While this is empty the checkout
   still renders the proof and says plainly that ordering is not on yet, so a
   half configured site never silently drops an order on the floor. */
window.GIFTY_CONFIG.turnstileSiteKey = '';


/* Cloudflare Web Analytics. Cookieless and it stores nothing on the device, so
   there is no consent banner on this site and there is not going to be one.
   The token is public by design like everything else in this file. While it is
   empty nothing at all is loaded, which is why a site without analytics makes
   no third party request rather than a failing one. */
window.GIFTY_CONFIG.analyticsToken = '';
