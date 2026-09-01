/* Gifty. Client configuration.
   This file is public by design. The apiKey here is a project identifier, not a
   credential, and it is meant to ship in the bundle. Access is controlled by the
   security rules and by App Check, never by hiding this object.
   There are no other secrets. This site has no server and no third party keys:
   it talks to the database and to nothing else.

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

/* storageBucket is present because the console hands it over, and nothing uses
   it. Cloud Storage left the Spark plan on 2026-02-03, which is the whole
   reason every image on an order rides inside the database instead, base64 and
   split into chunks. See js/order.js. */

/* Analytics. Cookieless, so there is no consent banner on this site and there
   is not going to be one. While this is empty nothing at all is loaded, which
   is why a site without analytics makes no third party request rather than a
   failing one. Empty is also the honest setting right now: the site talks to
   the database and to nothing else. */
window.GIFTY_CONFIG.analyticsToken = '';
