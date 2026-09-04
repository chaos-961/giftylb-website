/* Gifty engine. Photo intake and the resolution gate.
 *
 * Two representations of every upload, on purpose:
 *   - the working image, full resolution, used for the preview and later for
 *     the print file, so nothing is thrown away before it has to be
 *   - a downscaled copy for autosave, because localStorage cannot hold a phone
 *     camera JPEG and a silently failed save is worse than a smaller one
 */
(function (G) {
  'use strict';

  var Photo = G.Photo = {};

  var seq = 0;

  Photo.ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
  Photo.MAX_BYTES = 25 * 1024 * 1024;

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('read failed')); };
      fr.readAsDataURL(file);
    });
  }

  function downscale(img, maxEdge) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, maxEdge / Math.max(w, h));
    if (scale >= 1) return null;
    var c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.86);
  }

  /* Accepts a File, returns a photo object ready to drop into a zone.
     Errors blame the system, never the buyer. */
  Photo.fromFile = function (file, zone, canvasW) {
    if (!file) return Promise.reject(new Error('No file'));
    if (file.size > Photo.MAX_BYTES) {
      return Promise.reject(new Error('That photo is larger than we can handle here. Send it on WhatsApp and we will place it for you.'));
    }
    return readAsDataUrl(file)
      .then(G.Recipe.loadImage)
      .then(function (img) {
        var id = 'photo:' + (++seq) + ':' + Date.now();
        G.State.imageCache[id] = img;
        var photo = Object.assign({}, G.Design.PHOTO_DEFAULTS, {
          id: id,
          image: img,
          natW: img.naturalWidth,
          natH: img.naturalHeight,
          saveSrc: downscale(img, G.State.AUTOSAVE_MAX_EDGE) || img.src,
          k: 1, ox: 0, oy: 0
        });
        Photo.fitCover(photo, zone, canvasW);
        return photo;
      })
      .catch(function (err) {
        if (err && err.message && err.message.indexOf('WhatsApp') > 0) throw err;
        throw new Error('We could not open that image. It may be a format we do not read yet.');
      });
  };

  /* A quarter turn swaps the picture's width and height, so the layout it was
     panned and zoomed against no longer exists. It is refitted to cover, which
     is where every photo starts, rather than left hanging off one edge. */
  Photo.turn = function (photo, zone) {
    photo.rot = ((+photo.rot || 0) + 90) % 360;
    var dims = G.Design.photoDims(photo.image, photo.rot);
    photo.natW = dims.w; photo.natH = dims.h;
    return Photo.fitCover(photo, zone);
  };

  /* Mirrored about the middle of the zone, so a face that was on the left is
     now on the right and nothing else about the crop changes. */
  Photo.mirror = function (photo, zone) {
    photo.flip = !photo.flip;
    var size = G.Design.sizeFor(zone);
    photo.ox = size.w - (photo.ox + photo.natW * photo.k);
    return Photo.clamp(photo, zone);
  };

  /* Centre the photo and scale it so it covers the zone with nothing empty. */
  Photo.fitCover = function (photo, zone, canvasW) {
    var size = G.Design.sizeFor(zone);
    photo.k = G.Design.coverScale(photo, size.w, size.h);
    photo.ox = (size.w - photo.natW * photo.k) / 2;
    photo.oy = (size.h - photo.natH * photo.k) / 2;
    return photo;
  };

  /* Keep the photo on the zone after any pan or zoom. A photo may be smaller
     than the print area now, a round picture on a coloured mug say, so the
     rule is no longer "cover it": it is that a good part of the photo stays
     inside, so a drag can never lose it off an edge. Zoom bottoms out at a
     quarter of cover. */
  Photo.MIN_ZOOM = 0.25;
  Photo.clamp = function (photo, zone) {
    var size = G.Design.sizeFor(zone);
    var min = G.Design.coverScale(photo, size.w, size.h) * Photo.MIN_ZOOM;
    if (photo.k < min) photo.k = min;
    var dw = photo.natW * photo.k, dh = photo.natH * photo.k;
    var keepX = Math.min(dw, size.w) * 0.35, keepY = Math.min(dh, size.h) * 0.35;
    photo.ox = Math.min(size.w - keepX, Math.max(keepX - dw, photo.ox));
    photo.oy = Math.min(size.h - keepY, Math.max(keepY - dh, photo.oy));
    return photo;
  };

  /* Where a generated picture (the moon) lands on a zone: centred across,
     sitting in the upper part, at about seven tenths of the width. */
  Photo.placeFeature = function (photo, zone) {
    var size = G.Design.sizeFor(zone);
    photo.k = (size.w * 0.72) / photo.natW;
    photo.ox = (size.w - photo.natW * photo.k) / 2;
    photo.oy = size.h * 0.36 - photo.natH * photo.k / 2;
    return photo;
  };

  /* --------------------------------------------------------------- the gate
     Warn, show what it will really look like, and let them decide. Nobody in
     this market does this, and it is the main source of "the print is blurry"
     after the fact. */

  Photo.check = function (zone, photo) {
    var size = G.Design.sizeFor(zone);
    var dpi = G.Design.effectiveDpi(zone, photo, size.w);
    if (dpi == null) return null;
    return {
      dpi: Math.round(dpi),
      min: zone.minDpi,
      ok: dpi >= zone.minDpi,
      /* How much they would need to zoom out to clear the gate. */
      needScale: dpi >= zone.minDpi ? 1 : dpi / zone.minDpi
    };
  };

})(window.Gifty = window.Gifty || {});
