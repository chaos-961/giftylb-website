/* Gifty. A self contained lunar ephemeris. No dependencies, no network.
 *
 * Everything here follows Jean Meeus, "Astronomical Algorithms" (2nd ed.):
 *   ch. 10  delta T
 *   ch. 22  nutation and obliquity
 *   ch. 25  solar coordinates
 *   ch. 47  lunar position, the truncated ELP-2000/82 series
 *   ch. 48  illuminated fraction
 *   ch. 53  physical ephemeris of the Moon (libration, position angle)
 *
 * Accuracy of the truncated series is about 10 arcseconds in longitude,
 * 4 arcseconds in latitude and 50 km in distance, which is far below one
 * rendered pixel and keeps phase timings correct to well under a minute.
 *
 * Angles are in degrees at the interface and radians only inside the maths.
 * Checked against the worked examples in Meeus by tools/test-lunar.mjs.
 */
(function (G) {
  'use strict';

  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var AU_KM = 149597870.7;
  var MOON_RADIUS_KM = 1737.4;
  var SYNODIC = 29.530588861;
  var J2000 = 2451545.0;

  function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function norm180(x) { x = norm360(x); return x > 180 ? x - 360 : x; }
  function sind(x) { return Math.sin(x * D2R); }
  function cosd(x) { return Math.cos(x * D2R); }

  /* ---------- time ------------------------------------------------------ */

  function dateToJD(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function jdToDate(jd) {
    return new Date(Math.round((jd - 2440587.5) * 86400000));
  }

  function jdToDecimalYear(jd) {
    var d = jdToDate(jd);
    return d.getUTCFullYear() + (d.getUTCMonth() + 0.5) / 12;
  }

  /* Delta T, the gap between Terrestrial Time and Universal Time, from the
     Espenak and Meeus polynomial fits. Returned in seconds. It only shifts
     phase timings by a minute or so, but it is cheap to get right. */
  function deltaTSeconds(year) {
    var t, u;
    if (year < 1800) {
      u = (year - 1820) / 100;
      return -20 + 32 * u * u;
    }
    if (year < 1860) {
      t = year - 1800;
      return 13.72 - 0.332447 * t + 0.0068612 * t * t + 0.0041116 * Math.pow(t, 3)
        - 0.00037436 * Math.pow(t, 4) + 0.0000121272 * Math.pow(t, 5)
        - 0.0000001699 * Math.pow(t, 6) + 0.000000000875 * Math.pow(t, 7);
    }
    if (year < 1900) {
      t = year - 1860;
      return 7.62 + 0.5737 * t - 0.251754 * t * t + 0.01680668 * Math.pow(t, 3)
        - 0.0004473624 * Math.pow(t, 4) + Math.pow(t, 5) / 233174;
    }
    if (year < 1920) {
      t = year - 1900;
      return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * Math.pow(t, 3)
        - 0.000197 * Math.pow(t, 4);
    }
    if (year < 1941) {
      t = year - 1920;
      return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * Math.pow(t, 3);
    }
    if (year < 1961) {
      t = year - 1950;
      return 29.07 + 0.407 * t - t * t / 233 + Math.pow(t, 3) / 2547;
    }
    if (year < 1986) {
      t = year - 1975;
      return 45.45 + 1.067 * t - t * t / 260 - Math.pow(t, 3) / 718;
    }
    if (year < 2005) {
      t = year - 2000;
      return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * Math.pow(t, 3)
        + 0.000651814 * Math.pow(t, 4) + 0.00002373599 * Math.pow(t, 5);
    }
    if (year < 2050) {
      t = year - 2000;
      return 62.92 + 0.32217 * t + 0.005589 * t * t;
    }
    if (year < 2150) {
      u = (year - 1820) / 100;
      return -20 + 32 * u * u - 0.5628 * (2150 - year);
    }
    u = (year - 1820) / 100;
    return -20 + 32 * u * u;
  }

  /* Julian Ephemeris Day: the series below are all functions of TT. */
  function jdToJDE(jd) {
    return jd + deltaTSeconds(jdToDecimalYear(jd)) / 86400;
  }

  /* ---------- nutation and obliquity, ch. 22 ---------------------------- */

  function nutation(T) {
    var om = 125.04452 - 1934.136261 * T;
    var ls = 280.4665 + 36000.7698 * T;
    var lm = 218.3165 + 481267.8813 * T;
    var dPsi = (-17.20 * sind(om) - 1.32 * sind(2 * ls)
      - 0.23 * sind(2 * lm) + 0.21 * sind(2 * om)) / 3600;
    var dEps = (9.20 * cosd(om) + 0.57 * cosd(2 * ls)
      + 0.10 * cosd(2 * lm) - 0.09 * cosd(2 * om)) / 3600;
    var eps0 = 23 + 26 / 60 + 21.448 / 3600
      - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
    return { dPsi: dPsi, dEps: dEps, eps0: eps0, eps: eps0 + dEps, omega: om };
  }

  /* ---------- solar coordinates, ch. 25 --------------------------------- */

  function sunPosition(T) {
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    var M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    var e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M)
      + (0.019993 - 0.000101 * T) * sind(2 * M)
      + 0.000289 * sind(3 * M);
    var trueLon = L0 + C;
    var v = M + C;
    var R = 1.000001018 * (1 - e * e) / (1 + e * cosd(v));
    var om = 125.04 - 1934.136 * T;
    var apparent = trueLon - 0.00569 - 0.00478 * sind(om);
    return { trueLon: norm360(trueLon), apparentLon: norm360(apparent), radiusAU: R };
  }

  /* ---------- lunar position, ch. 47 ------------------------------------
     Table 47.A holds the periodic terms for longitude (units of 1e-6 deg)
     and distance (units of 1e-3 km), table 47.B the terms for latitude.
     The first four columns are the multiples of D, M, Mprime and F.      */

  var TERMS_LR = [
    [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
    [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
    [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
    [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
    [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
    [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
    [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
    [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
    [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
    [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
    [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
    [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
    [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
    [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
    [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
    [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
    [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
    [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
    [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752]
  ];

  var TERMS_B = [
    [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
    [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
    [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
    [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
    [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
    [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
    [2, 1, -1, 1, -366], [2, 1, 0, 1, -351], [4, 0, 0, 1, 331],
    [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
    [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
    [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185],
    [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176],
    [4, -1, -1, -1, 166], [1, 0, 1, -1, -164], [4, 0, 1, -1, 132],
    [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107]
  ];

  function moonPosition(T) {
    var Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
      + T * T * T / 538841 - T * T * T * T / 65194000;
    var D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
      + T * T * T / 545868 - T * T * T * T / 113065000;
    var M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T
      + T * T * T / 24490000;
    var Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
      + T * T * T / 69699 - T * T * T * T / 14712000;
    var F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T
      - T * T * T / 3526000 + T * T * T * T / 863310000;

    var A1 = 119.75 + 131.849 * T;
    var A2 = 53.09 + 479264.290 * T;
    var A3 = 313.45 + 481266.484 * T;

    /* Eccentricity correction for terms involving the solar anomaly. */
    var E = 1 - 0.002516 * T - 0.0000074 * T * T;
    var E2 = E * E;

    var sumL = 0, sumR = 0, sumB = 0, i, t, arg, f;

    for (i = 0; i < TERMS_LR.length; i++) {
      t = TERMS_LR[i];
      arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
      f = t[1] === 0 ? 1 : (Math.abs(t[1]) === 1 ? E : E2);
      sumL += t[4] * f * sind(arg);
      sumR += t[5] * f * cosd(arg);
    }
    for (i = 0; i < TERMS_B.length; i++) {
      t = TERMS_B[i];
      arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
      f = t[1] === 0 ? 1 : (Math.abs(t[1]) === 1 ? E : E2);
      sumB += t[4] * f * sind(arg);
    }

    /* Additive terms for Venus, Jupiter and the flattening of the Earth. */
    sumL += 3958 * sind(A1) + 1962 * sind(Lp - F) + 318 * sind(A2);
    sumB += -2235 * sind(Lp) + 382 * sind(A3) + 175 * sind(A1 - F)
      + 175 * sind(A1 + F) + 127 * sind(Lp - Mp) - 115 * sind(Lp + Mp);

    return {
      lonTrue: norm360(Lp + sumL / 1000000),
      lat: sumB / 1000000,
      distanceKm: 385000.56 + sumR / 1000,
      Lp: Lp, D: D, M: M, Mp: Mp, F: F
    };
  }

  /* ---------- libration and the illuminated face, ch. 53 ----------------
     Optical libration only. The physical libration adds at most 0.04
     degrees, a small fraction of a pixel on a rendered disc.             */

  var INC = 1.54242; // inclination of the mean lunar equator to the ecliptic

  function opticalLibration(lonTrue, lat, omega, F) {
    var W = norm360(lonTrue - omega);
    var sW = sind(W), cW = cosd(W), sB = sind(lat), cB = cosd(lat);
    var sI = sind(INC), cI = cosd(INC);
    var A = Math.atan2(sW * cB * cI - sB * sI, cW * cB) * R2D;
    return {
      lon: norm180(A - F),
      lat: Math.asin(-sW * cB * sI - sB * cI) * R2D
    };
  }

  /* ---------- the assembled state --------------------------------------- */

  function stateAtJD(jd) {
    var jde = jdToJDE(jd);
    var T = (jde - J2000) / 36525;

    var nut = nutation(T);
    var sun = sunPosition(T);
    var moon = moonPosition(T);

    var omega = 125.0445479 - 1934.1362891 * T + 0.0020754 * T * T
      + T * T * T / 467441 - T * T * T * T / 60616000;

    var moonLonApp = norm360(moon.lonTrue + nut.dPsi);
    var sunLonApp = sun.apparentLon;
    var sunKm = sun.radiusAU * AU_KM;

    /* Geocentric elongation and phase angle, ch. 48. */
    var psi = Math.acos(cosd(moon.lat) * cosd(moonLonApp - sunLonApp)) * R2D;
    var phaseAngle = Math.atan2(
      sunKm * sind(psi),
      moon.distanceKm - sunKm * cosd(psi)
    ) * R2D;
    var illumination = (1 + cosd(phaseAngle)) / 2;

    /* Age angle: 0 at new moon, 90 at first quarter, 180 at full. */
    var ageAngle = norm360(moonLonApp - sunLonApp);

    /* Where the Earth sits in the lunar sky, which is the centre of the
       face we can see. */
    var lib = opticalLibration(moon.lonTrue, moon.lat, omega, moon.F);

    /* Where the Sun sits, 53.9 and 53.10: the same formulae fed the Sun as
       seen from the Moon. This fixes the terminator exactly. */
    var ratio = moon.distanceKm / sunKm;
    var lonH = sunLonApp + 180 + ratio * 57.296 * cosd(moon.lat)
      * sind(sunLonApp - moon.lonTrue);
    var latH = ratio * moon.lat;
    var sub = opticalLibration(norm360(lonH - nut.dPsi), latH, omega, moon.F);

    /* Position angle of the lunar axis, 53.5, with the physical libration
       terms rho, sigma and tau taken as zero. */
    var eps = nut.eps;
    var ra = Math.atan2(
      sind(moonLonApp) * cosd(eps) - Math.tan(moon.lat * D2R) * sind(eps),
      cosd(moonLonApp)
    ) * R2D;
    var dec = Math.asin(
      sind(moon.lat) * cosd(eps) + cosd(moon.lat) * sind(eps) * sind(moonLonApp)
    ) * R2D;
    var V = omega + nut.dPsi;
    var X = sind(INC) * sind(V);
    var Y = sind(INC) * cosd(V) * cosd(eps) - cosd(INC) * sind(eps);
    var w = Math.atan2(X, Y) * R2D;
    var posAngle = Math.asin(
      Math.sqrt(X * X + Y * Y) * cosd(ra - w) / cosd(lib.lat)
    ) * R2D;

    var angularDiameter = 2 * Math.asin(MOON_RADIUS_KM / moon.distanceKm) * R2D;

    return {
      jd: jd,
      date: jdToDate(jd),
      moonLon: moonLonApp,
      moonLat: moon.lat,
      distanceKm: moon.distanceKm,
      sunLon: sunLonApp,
      sunDistanceKm: sunKm,
      elongation: psi,
      phaseAngle: phaseAngle,
      illumination: illumination,
      ageAngle: ageAngle,
      waxing: ageAngle < 180,
      librationLon: lib.lon,
      librationLat: lib.lat,
      subSolarLon: sub.lon,
      subSolarLat: sub.lat,
      positionAngle: posAngle,
      rightAscension: norm360(ra),
      declination: dec,
      angularDiameterDeg: angularDiameter,
      angularDiameterArcmin: angularDiameter * 60
    };
  }

  function stateAt(date) {
    return stateAtJD(dateToJD(date));
  }

  /* ---------- phase events ---------------------------------------------
     Elongation grows by 12.19 degrees a day and never reverses, so a fixed
     step iteration on the wrapped difference converges quickly and cannot
     wander into the neighbouring lunation.                                */

  var MEAN_RATE = 360 / SYNODIC; // 12.1907 degrees per day

  function elongationAt(jd) {
    var T = (jdToJDE(jd) - J2000) / 36525;
    var nut = nutation(T);
    var m = moonPosition(T);
    var s = sunPosition(T);
    return norm360(m.lonTrue + nut.dPsi - s.apparentLon);
  }

  function refineEvent(jd, targetDeg) {
    for (var i = 0; i < 12; i++) {
      var g = norm180(elongationAt(jd) - targetDeg);
      jd -= g / MEAN_RATE;
      if (Math.abs(g) < 1e-7) break;
    }
    return jd;
  }

  function nextEvent(jd, targetDeg) {
    var gap = norm360(targetDeg - elongationAt(jd));
    return refineEvent(jd + gap / MEAN_RATE, targetDeg);
  }

  function previousEvent(jd, targetDeg) {
    var gap = norm360(elongationAt(jd) - targetDeg);
    return refineEvent(jd - gap / MEAN_RATE, targetDeg);
  }

  /* Brown lunation number. Lunation 953 began at the new moon of
     2000 January 6, which is the k = 0 epoch of Meeus ch. 49. */
  function lunationNumber(jd) {
    return Math.round((previousEvent(jd, 0) - 2451550.09766) / SYNODIC) + 953;
  }

  function countEventsBetween(jdStart, jdEnd, targetDeg) {
    if (jdEnd <= jdStart) return 0;
    var first = nextEvent(jdStart, targetDeg);
    if (first > jdEnd) return 0;
    var last = previousEvent(jdEnd, targetDeg);
    if (last < first) return 1;
    return Math.round((last - first) / SYNODIC) + 1;
  }

  /* ---------- naming ---------------------------------------------------- */

  var PHASE_NAMES = [
    'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'
  ];

  /* The four principal phases are instants, so each gets a window of about
     half a day either side before the name gives way to its neighbour. */
  function phaseName(ageAngle) {
    var a = norm360(ageAngle);
    if (a < 6 || a >= 354) return PHASE_NAMES[0];
    if (a < 84) return PHASE_NAMES[1];
    if (a < 96) return PHASE_NAMES[2];
    if (a < 174) return PHASE_NAMES[3];
    if (a < 186) return PHASE_NAMES[4];
    if (a < 264) return PHASE_NAMES[5];
    if (a < 276) return PHASE_NAMES[6];
    return PHASE_NAMES[7];
  }

  var ZODIAC = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
    'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

  function zodiacSign(lon) {
    return ZODIAC[Math.floor(norm360(lon) / 30)];
  }

  /* Perigee runs about 356500 km, apogee about 406700 km. */
  function distanceLabel(km) {
    if (km < 362000) return 'near perigee';
    if (km > 401000) return 'near apogee';
    return 'mid range';
  }

  G.Lunar = {
    dateToJD: dateToJD,
    jdToDate: jdToDate,
    stateAt: stateAt,
    stateAtJD: stateAtJD,
    elongationAt: elongationAt,
    nextEvent: nextEvent,
    previousEvent: previousEvent,
    countEventsBetween: countEventsBetween,
    lunationNumber: lunationNumber,
    phaseName: phaseName,
    zodiacSign: zodiacSign,
    distanceLabel: distanceLabel,
    deltaTSeconds: deltaTSeconds,
    SYNODIC: SYNODIC,
    MOON_RADIUS_KM: MOON_RADIUS_KM,

    /* Raw building blocks, exposed so tools/test-lunar.mjs can be checked
       against the worked examples printed in Meeus. */
    _internal: {
      nutation: nutation,
      sunPosition: sunPosition,
      moonPosition: moonPosition,
      opticalLibration: opticalLibration,
      J2000: J2000
    }
  };
})(window.Gifty = window.Gifty || {});
