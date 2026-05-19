// Beispiel-POIs: Ersetze diese Koordinaten durch deine echten POIs.
// Diese Version nutzt A-Frame ohne AR.js.
// Kamera: getUserMedia()
// Standort: Geolocation API
// Blickrichtung: DeviceOrientation API
// 2D-Karte: OpenLayers
//
// Orientierung:
// Die Blickrichtung wird geglättet und nur in Schritten von 0,1 Radiant aktualisiert.
// Dadurch flackern die POIs weniger bei kleinen Sensorbewegungen.

const POIS = [
  {
    id: "poi-1",
    name: "Grundschule Herscheid",
    latitude: 51.1822749934445,
    longitude: 7.740670637170724,
    color: "#ff4d4d"
  },
  {
    id: "poi-2",
    name: "Cafe Sirringhaus",
    latitude: 51.17875782351786,
    longitude: 7.742893710182059,
    color: "#4da3ff"
  },
  {
    id: "poi-3",
    name: "Friedhof Herscheid",
    latitude: 51.181167288767355,
    longitude: 7.7490359684231676,
    color: "#7cff6b"
  },
  {
    id: "poi-4",
    name: "Bluebox",
    latitude: 51.44785137147361,
    longitude: 7.269841017508729,
    color: "#ea4375"
  },
  {
    id: "poi-5",
    name: "Mensa",
    latitude: 51.446236176959104,
    longitude: 7.272138472686522,
    color: "#ae6bff"
  },
  {
    id: "poi-6",
    name: "Haupteingang",
    latitude: 51.44794187637043,
    longitude: 7.270682548887014,
    color: "#6be1ff"
  }
];

let scene = null;
let cameraVideo = null;
let cameraRig = null;

let statusEl = null;
let poiListEl = null;

let arViewButton = null;
let mapViewButton = null;
let cameraStartButton = null;

let currentUserLonLat = null;
let currentUserMapCoords = null;
let currentHeading = null;

let cameraStreamStarted = false;
let orientationStarted = false;
let orientationPermissionState = "unknown";
let geoWatchId = null;

let map = null;
let selectedPoiFeature = null;
let mapInitialized = false;

let locationSource = null;
let headingSource = null;
let routeSource = null;
let popupOverlay = null;
let popupContent = null;

let poiLayer = null;
let locationLayer = null;
let headingLayer = null;
let osmLayer = null;
let satelliteLayer = null;
let topoLayer = null;

let aFrameContentCreated = false;

const MAX_VISIBLE_DISTANCE = 3000;

// 0,1 Radiant entspricht ca. 5,73 Grad.
// Größerer Wert = weniger empfindlich.
// Kleinerer Smoothing-Faktor = ruhiger, aber träger.
const ORIENTATION_STEP_RADIANS = 0.1;
const ORIENTATION_SMOOTHING_FACTOR = 0.18;

let smoothedHeadingRad = null;
let lastHeadingBucket = null;

const toRad = value => value * Math.PI / 180;
const toDeg = value => value * 180 / Math.PI;

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function normalizeDegrees(degrees) {
  return ((degrees + 540) % 360) - 180;
}

function normalizeRadiansPositive(radians) {
  const fullCircle = Math.PI * 2;
  return ((radians % fullCircle) + fullCircle) % fullCircle;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getHarmonizedHeading(rawHeadingDegrees) {
  const rawHeadingRad = normalizeRadiansPositive(toRad(rawHeadingDegrees));

  if (smoothedHeadingRad === null) {
    smoothedHeadingRad = rawHeadingRad;
  } else {
    const previousX = Math.cos(smoothedHeadingRad);
    const previousY = Math.sin(smoothedHeadingRad);

    const rawX = Math.cos(rawHeadingRad);
    const rawY = Math.sin(rawHeadingRad);

    const mixedX =
      previousX * (1 - ORIENTATION_SMOOTHING_FACTOR) +
      rawX * ORIENTATION_SMOOTHING_FACTOR;

    const mixedY =
      previousY * (1 - ORIENTATION_SMOOTHING_FACTOR) +
      rawY * ORIENTATION_SMOOTHING_FACTOR;

    smoothedHeadingRad = normalizeRadiansPositive(Math.atan2(mixedY, mixedX));
  }

  const bucket = Math.round(smoothedHeadingRad / ORIENTATION_STEP_RADIANS);
  const quantizedRad = normalizeRadiansPositive(bucket * ORIENTATION_STEP_RADIANS);
  const quantizedDegrees = (toDeg(quantizedRad) + 360) % 360;

  return {
    bucket,
    radians: quantizedRad,
    degrees: quantizedDegrees
  };
}

function getAFrameParent() {
  return cameraRig || scene;
}

function registerFaceCameraComponent() {
  if (typeof AFRAME === "undefined") {
    console.warn("A-Frame ist noch nicht geladen.");
    return;
  }

  if (AFRAME.components["face-camera-y"]) {
    return;
  }

  AFRAME.registerComponent("face-camera-y", {
    tick: function () {
      const camera = document.querySelector("#aframeCamera");

      if (!camera || !camera.object3D || !this.el.object3D) {
        return;
      }

      const cameraWorldPosition = new AFRAME.THREE.Vector3();
      const objectWorldPosition = new AFRAME.THREE.Vector3();

      camera.object3D.getWorldPosition(cameraWorldPosition);
      this.el.object3D.getWorldPosition(objectWorldPosition);

      const dx = cameraWorldPosition.x - objectWorldPosition.x;
      const dz = cameraWorldPosition.z - objectWorldPosition.z;

      const angle = Math.atan2(dx, dz);

      this.el.object3D.rotation.set(0, angle, 0);
    }
  });
}

function distanceInMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
}

function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }

  return `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} Min.`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  return `${hours} Std. ${restMinutes} Min.`;
}

function calculateBearing(userLat, userLon, poiLat, poiLon) {
  const lat1 = toRad(userLat);
  const lat2 = toRad(poiLat);
  const dLon = toRad(poiLon - userLon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const bearingRad = Math.atan2(y, x);
  const bearingDeg = toDeg(bearingRad);

  return (bearingDeg + 360) % 360;
}

function getAFramePositionForPoi(userLat, userLon, poi, visibleIndex) {
  const realDistance = distanceInMeters(
    userLat,
    userLon,
    poi.latitude,
    poi.longitude
  );

  const visualDistance = Math.min(Math.max(realDistance * 0.06, 8), 22);

  if (currentHeading === null) {
    return {
      x: -5 + visibleIndex * 5,
      y: -1.2 + visibleIndex * 0.7,
      z: -14
    };
  }

  const bearing = calculateBearing(userLat, userLon, poi.latitude, poi.longitude);
  const relativeAngle = normalizeDegrees(bearing - currentHeading);

  const visibleAngle = clamp(relativeAngle, -35, 35);
  const angleRad = toRad(visibleAngle);

  return {
    x: Math.sin(angleRad) * visualDistance,
    y: -1.2 + visibleIndex * 0.8,
    z: -Math.cos(angleRad) * visualDistance
  };
}

function updateAFramePoiPositions(latitude, longitude) {
  let visiblePoiCount = 0;

  POIS.forEach(poi => {
    const marker = document.querySelector(`#${poi.id}`);

    if (!marker) {
      return;
    }

    const distance = distanceInMeters(
      latitude,
      longitude,
      poi.latitude,
      poi.longitude
    );

    if (distance > MAX_VISIBLE_DISTANCE) {
      marker.setAttribute("visible", "false");
      marker.setAttribute("position", "0 -9999 0");
      return;
    }

    const position = getAFramePositionForPoi(
      latitude,
      longitude,
      poi,
      visiblePoiCount
    );

    marker.setAttribute("position", `${position.x} ${position.y} ${position.z}`);
    marker.setAttribute("visible", "true");

    visiblePoiCount++;
  });

  return visiblePoiCount;
}

async function startAFrameCamera() {
  if (cameraStreamStarted) {
    return true;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Dieser Browser unterstützt keine Kamerafreigabe.");
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: {
          ideal: "environment"
        }
      },
      audio: false
    });

    if (cameraVideo) {
      cameraVideo.srcObject = stream;

      try {
        await cameraVideo.play();
      } catch (playError) {
        console.warn("Video konnte nicht automatisch abgespielt werden:", playError);
      }
    }

    cameraStreamStarted = true;
    setStatus("Kamera aktiv. Standort wird angefragt …");

    return true;
  } catch (error) {
    console.error("Kamera-Fehler:", error);
    setStatus("Kamera konnte nicht gestartet werden. Bitte Kamerazugriff erlauben.");
    return false;
  }
}

function createPoiMarker(poi) {
  const parent = getAFrameParent();

  if (!parent) {
    console.error("A-Frame-Parent wurde nicht gefunden.");
    return;
  }

  if (document.querySelector(`#${poi.id}`)) {
    return;
  }

  const markerRoot = document.createElement("a-entity");

  markerRoot.setAttribute("id", poi.id);
  markerRoot.setAttribute("visible", "false");
  markerRoot.setAttribute("position", "0 -9999 0");

  const pinHead = document.createElement("a-sphere");
  pinHead.setAttribute("radius", "1.6");
  pinHead.setAttribute("position", "0 2.8 0");
  pinHead.setAttribute("material", `shader: flat; color: ${poi.color}; opacity: 1; depthTest: false`);

  const pinTip = document.createElement("a-cone");
  pinTip.setAttribute("radius-bottom", "1.05");
  pinTip.setAttribute("radius-top", "0");
  pinTip.setAttribute("height", "2.4");
  pinTip.setAttribute("position", "0 1.1 0");
  pinTip.setAttribute("rotation", "180 0 0");
  pinTip.setAttribute("material", `shader: flat; color: ${poi.color}; opacity: 1; depthTest: false`);

  const labelBackground = document.createElement("a-plane");
  labelBackground.setAttribute("position", "0 5.2 -0.05");
  labelBackground.setAttribute("width", "11");
  labelBackground.setAttribute("height", "2.8");
  labelBackground.setAttribute(
    "material",
    "shader: flat; color: black; opacity: 0.75; transparent: true; side: double; depthTest: false"
  );
  labelBackground.setAttribute("face-camera-y", "");

  const label = document.createElement("a-text");
  label.setAttribute("id", `${poi.id}-label`);
  label.setAttribute("value", poi.name);
  label.setAttribute("align", "center");
  label.setAttribute("anchor", "center");
  label.setAttribute("baseline", "center");
  label.setAttribute("face-camera-y", "");
  label.setAttribute("scale", "2.1 2.1 2.1");
  label.setAttribute("position", "0 5.2 0");
  label.setAttribute("material", "shader: flat; color: white; depthTest: false");

  pinHead.setAttribute(
    "animation",
    "property: scale; dir: alternate; dur: 850; loop: true; to: 1.18 1.18 1.18"
  );

  markerRoot.appendChild(pinHead);
  markerRoot.appendChild(pinTip);
  markerRoot.appendChild(labelBackground);
  markerRoot.appendChild(label);

  parent.appendChild(markerRoot);
}

function renderPois() {
  if (aFrameContentCreated) {
    return;
  }

  POIS.forEach(createPoiMarker);
  aFrameContentCreated = true;
}

function initializeAFrameContent() {
  if (!scene) {
    return;
  }

  if (scene.hasLoaded) {
    renderPois();
    return;
  }

  scene.addEventListener("loaded", function () {
    renderPois();
  });
}

function updatePoiDistances(position) {
  const { latitude, longitude, accuracy } = position.coords;

  currentUserLonLat = [longitude, latitude];

  const visiblePoiCount = updateAFramePoiPositions(latitude, longitude);

  const sortedPois = POIS
    .map(poi => ({
      ...poi,
      distance: distanceInMeters(
        latitude,
        longitude,
        poi.latitude,
        poi.longitude
      )
    }))
    .sort((a, b) => a.distance - b.distance);

  sortedPois.forEach(poi => {
    const label = document.querySelector(`#${poi.id}-label`);

    if (label) {
      label.setAttribute("value", `${poi.name}\n${Math.round(poi.distance)} m`);
    }
  });

  if (poiListEl) {
    poiListEl.innerHTML = sortedPois
      .map((poi, index) => {
        const className = index === 0 ? "poi-near" : "";
        return `<div class="${className}">${poi.name}: ${Math.round(
          poi.distance
        )} m</div>`;
      })
      .join("");
  }

  const headingText =
    currentHeading === null
      ? "Blickrichtung fehlt, Fallback aktiv"
      : `Blickrichtung ${Math.round(currentHeading)}°`;

  setStatus(
    `Standort aktiv: ±${Math.round(accuracy)} m | POIs sichtbar: ${visiblePoiCount} | ${headingText}`
  );

  updateMapLocation(longitude, latitude, accuracy);
}

function handleGeoError(error) {
  console.error("Geolocation-Fehler:", error);

  const messages = {
    1: "Standortzugriff wurde abgelehnt. Bitte in Safari den Standort erlauben.",
    2: "Standort konnte nicht bestimmt werden. Bitte Ortungsdienste prüfen und möglichst nach draußen gehen.",
    3: "Standortabfrage hat zu lange gedauert. Tippe erneut auf Kamera und Standort starten."
  };

  setStatus(messages[error.code] || "Unbekannter Standortfehler.");
}

function startGeolocationWatch() {
  if (!window.isSecureContext) {
    setStatus("Standort benötigt HTTPS. Bitte GitHub Pages mit https:// öffnen.");
    return;
  }

  if (!("geolocation" in navigator)) {
    setStatus("Dieses Gerät unterstützt keine Geolocation API.");
    return;
  }

  setStatus("Standort wird angefragt …");

  const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 20000
  };

  navigator.geolocation.getCurrentPosition(
    function (position) {
      updatePoiDistances(position);

      if (geoWatchId === null) {
        geoWatchId = navigator.geolocation.watchPosition(
          updatePoiDistances,
          handleGeoError,
          geoOptions
        );
      }
    },
    handleGeoError,
    geoOptions
  );
}

function getHeadingFromEvent(event) {
  if (typeof event.webkitCompassHeading === "number") {
    return event.webkitCompassHeading;
  }

  if (typeof event.alpha === "number") {
    return (360 - event.alpha) % 360;
  }

  return null;
}

function updateAFrameCameraHeading() {
  if (cameraRig) {
    cameraRig.setAttribute("rotation", "0 0 0");
  }
}

function handleDeviceOrientation(event) {
  const rawHeading = getHeadingFromEvent(event);

  if (rawHeading === null) {
    return;
  }

  const harmonizedHeading = getHarmonizedHeading(rawHeading);

  if (lastHeadingBucket === harmonizedHeading.bucket) {
    return;
  }

  lastHeadingBucket = harmonizedHeading.bucket;
  currentHeading = harmonizedHeading.degrees;

  updateAFrameCameraHeading();
  updateHeadingCone();

  if (currentUserLonLat) {
    updateAFramePoiPositions(currentUserLonLat[1], currentUserLonLat[0]);
  }
}

async function activateHeading() {
  try {
    if (!window.DeviceOrientationEvent) {
      orientationPermissionState = "unsupported";
      return false;
    }

    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      orientationPermissionState = permission;

      if (permission !== "granted") {
        return false;
      }
    } else {
      orientationPermissionState = "granted";
    }

    if (!orientationStarted) {
      window.addEventListener(
        "deviceorientationabsolute",
        handleDeviceOrientation,
        true
      );
      window.addEventListener("deviceorientation", handleDeviceOrientation, true);
      orientationStarted = true;
    }

    return true;
  } catch (error) {
    console.error("Blickrichtung-Fehler:", error);
    orientationPermissionState = "error";
    return false;
  }
}

async function startCameraAndLocation() {
  setStatus("Starte Kamera, Standort und Orientierung …");

  await activateHeading();

  const cameraOk = await startAFrameCamera();

  if (!cameraOk) {
    return;
  }

  startGeolocationWatch();
}

function transformCoords(lon, lat) {
  return ol.proj.fromLonLat([lon, lat]);
}

function transformToLonLat(coords) {
  return ol.proj.toLonLat(coords);
}

function getInitialMapCenter() {
  if (currentUserLonLat) {
    return transformCoords(currentUserLonLat[0], currentUserLonLat[1]);
  }

  const avgLon = POIS.reduce((sum, poi) => sum + poi.longitude, 0) / POIS.length;
  const avgLat = POIS.reduce((sum, poi) => sum + poi.latitude, 0) / POIS.length;

  return transformCoords(avgLon, avgLat);
}

function createPoiFeatures() {
  return POIS.map(
    poi =>
      new ol.Feature({
        geometry: new ol.geom.Point(
          transformCoords(poi.longitude, poi.latitude)
        ),
        name: poi.name,
        description: "POI aus der A-Frame-App",
        lon: poi.longitude,
        lat: poi.latitude,
        color: poi.color,
        type: "poi"
      })
  );
}

function initializeMap() {
  if (mapInitialized) {
    if (map) {
      map.updateSize();
    }
    return;
  }

  if (typeof ol === "undefined") {
    console.error("OpenLayers wurde nicht geladen.");
    return;
  }

  osmLayer = new ol.layer.Tile({
    title: "Straßenkarte",
    type: "base",
    visible: true,
    source: new ol.source.OSM()
  });

  satelliteLayer = new ol.layer.Tile({
    title: "Satellitenbild",
    type: "base",
    visible: false,
    source: new ol.source.XYZ({
      url:
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attributions:
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    })
  });

  topoLayer = new ol.layer.Tile({
    title: "Topografische Karte",
    type: "base",
    visible: false,
    source: new ol.source.XYZ({
      url: "https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attributions:
        "Kartendaten © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung © OpenTopoMap",
      maxZoom: 17
    })
  });

  const poiSource = new ol.source.Vector({
    features: createPoiFeatures()
  });

  poiLayer = new ol.layer.Vector({
    title: "POIs",
    visible: true,
    source: poiSource,
    style: function (feature) {
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 9,
          fill: new ol.style.Fill({
            color: feature.get("color") || "#dc2626"
          }),
          stroke: new ol.style.Stroke({
            color: "#ffffff",
            width: 2
          })
        })
      });
    }
  });

  locationSource = new ol.source.Vector();

  locationLayer = new ol.layer.Vector({
    title: "Mein Standort",
    visible: true,
    source: locationSource,
    style: function (feature) {
      if (feature.get("type") === "accuracy") {
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(37, 99, 235, 0.7)",
            width: 2
          }),
          fill: new ol.style.Fill({
            color: "rgba(37, 99, 235, 0.15)"
          })
        });
      }

      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 9,
          fill: new ol.style.Fill({
            color: "#2563eb"
          }),
          stroke: new ol.style.Stroke({
            color: "#ffffff",
            width: 3
          })
        })
      });
    }
  });

  headingSource = new ol.source.Vector();

  headingLayer = new ol.layer.Vector({
    title: "Blickrichtung",
    visible: true,
    source: headingSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: "rgba(245, 158, 11, 0.95)",
        width: 2
      }),
      fill: new ol.style.Fill({
        color: "rgba(245, 158, 11, 0.35)"
      })
    })
  });

  routeSource = new ol.source.Vector();

  const routeLayer = new ol.layer.Vector({
    title: "Route",
    visible: true,
    source: routeSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: "#16a34a",
        width: 5
      })
    })
  });

  map = new ol.Map({
    target: "map",
    layers: [
      osmLayer,
      satelliteLayer,
      topoLayer,
      routeLayer,
      headingLayer,
      poiLayer,
      locationLayer
    ],
    view: new ol.View({
      center: getInitialMapCenter(),
      zoom: 15
    })
  });

  popupContent = document.getElementById("popup-content");

  const popupContainer = document.getElementById("popup");
  const popupCloser = document.getElementById("popup-closer");

  popupOverlay = new ol.Overlay({
    element: popupContainer,
    positioning: "bottom-center",
    stopEvent: false,
    offset: [0, -16],
    autoPan: {
      animation: {
        duration: 250
      }
    }
  });

  map.addOverlay(popupOverlay);

  if (popupCloser) {
    popupCloser.addEventListener("click", function () {
      popupOverlay.setPosition(undefined);
      popupCloser.blur();
    });
  }

  map.on("singleclick", function (event) {
    const feature = map.forEachFeatureAtPixel(
      event.pixel,
      hitFeature => hitFeature
    );

    if (!feature) {
      popupOverlay.setPosition(undefined);
      return;
    }

    const name = feature.get("name");
    const description = feature.get("description");

    if (!name) {
      return;
    }

    if (popupContent) {
      popupContent.innerHTML = `
        <h3>${name}</h3>
        <p>${description || ""}</p>
      `;
    }

    const geometry = feature.getGeometry();

    if (geometry instanceof ol.geom.Point) {
      popupOverlay.setPosition(geometry.getCoordinates());
    } else {
      popupOverlay.setPosition(event.coordinate);
    }

    if (feature.get("type") === "poi") {
      calculateRouteToPoi(feature);
    }
  });

  setupMapControls();

  mapInitialized = true;

  if (currentUserLonLat) {
    updateMapLocation(currentUserLonLat[0], currentUserLonLat[1], 0);
  }

  window.setTimeout(function () {
    if (map) {
      map.updateSize();
    }
  }, 200);
}

function setupMapControls() {
  document.querySelectorAll("input[name='base-layer']").forEach(input => {
    input.addEventListener("change", function () {
      const selectedLayer = this.value;

      osmLayer.setVisible(selectedLayer === "osm");
      satelliteLayer.setVisible(selectedLayer === "satellite");
      topoLayer.setVisible(selectedLayer === "topo");
    });
  });

  const poiToggle = document.getElementById("poi-toggle");
  if (poiToggle) {
    poiToggle.addEventListener("change", function () {
      poiLayer.setVisible(this.checked);
    });
  }

  const locationToggle = document.getElementById("location-toggle");
  if (locationToggle) {
    locationToggle.addEventListener("change", function () {
      locationLayer.setVisible(this.checked);
    });
  }

  const headingToggle = document.getElementById("heading-toggle");
  if (headingToggle) {
    headingToggle.addEventListener("change", function () {
      headingLayer.setVisible(this.checked);
    });
  }

  const locateButton = document.getElementById("locate-button");
  if (locateButton) {
    locateButton.addEventListener("click", showUserLocation);
  }

  const headingButton = document.getElementById("heading-button");
  if (headingButton) {
    headingButton.addEventListener("click", activateHeading);
  }

  const routeProfile = document.getElementById("route-profile");
  if (routeProfile) {
    routeProfile.addEventListener("change", function () {
      if (selectedPoiFeature) {
        calculateRouteToPoi(selectedPoiFeature);
      }
    });
  }

  const clearRouteButton = document.getElementById("clear-route-button");
  if (clearRouteButton) {
    clearRouteButton.addEventListener("click", function () {
      if (routeSource) {
        routeSource.clear();
      }

      selectedPoiFeature = null;

      const routeText = document.getElementById("route-text");
      if (routeText) {
        routeText.textContent =
          "Wähle einen POI auf der Karte aus, um eine Route zu berechnen.";
      }
    });
  }
}

function updateMapLocation(lon, lat, accuracy) {
  if (!mapInitialized || !locationSource) {
    return;
  }

  const userCoords = transformCoords(lon, lat);
  currentUserMapCoords = userCoords;

  locationSource.clear();

  const accuracyFeature = new ol.Feature({
    geometry: new ol.geom.Circle(userCoords, accuracy || 0),
    type: "accuracy"
  });

  const locationFeature = new ol.Feature({
    geometry: new ol.geom.Point(userCoords),
    name: "Mein Standort",
    description: `Genauigkeit: ca. ${Math.round(accuracy || 0)} Meter`,
    type: "location"
  });

  locationSource.addFeature(accuracyFeature);
  locationSource.addFeature(locationFeature);

  updateHeadingCone();
}

function getUserLocation() {
  return new Promise(function (resolve, reject) {
    if (!navigator.geolocation) {
      reject(new Error("Dein Browser unterstützt keine Standortermittlung."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) {
        const lon = position.coords.longitude;
        const lat = position.coords.latitude;
        const accuracy = position.coords.accuracy;

        currentUserLonLat = [lon, lat];

        updateAFramePoiPositions(lat, lon);
        updateMapLocation(lon, lat, accuracy);

        resolve({
          lon,
          lat,
          accuracy,
          coords: transformCoords(lon, lat)
        });
      },
      function (error) {
        let message = "Dein Standort konnte nicht ermittelt werden.";

        if (error.code === error.PERMISSION_DENIED) {
          message = "Standortzugriff wurde verweigert. Bitte im Browser erlauben.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message = "Standortinformationen sind aktuell nicht verfügbar.";
        } else if (error.code === error.TIMEOUT) {
          message = "Die Standortermittlung hat zu lange gedauert.";
        }

        reject(new Error(message));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

function showUserLocation() {
  getUserLocation()
    .then(function (location) {
      if (!map) {
        return;
      }

      map.getView().animate({
        center: location.coords,
        zoom: 17,
        duration: 700
      });

      if (popupContent) {
        popupContent.innerHTML = `
          <h3>Mein Standort</h3>
          <p>Genauigkeit: ca. ${Math.round(location.accuracy)} Meter</p>
        `;
      }

      if (popupOverlay) {
        popupOverlay.setPosition(location.coords);
      }
    })
    .catch(function (error) {
      alert(error.message);
    });
}

function createHeadingCone(center, headingDegrees) {
  const coneLength = 80;
  const coneWidth = 35;

  const headingRad = toRad(headingDegrees);
  const leftRad = toRad(headingDegrees - coneWidth / 2);
  const rightRad = toRad(headingDegrees + coneWidth / 2);

  const centerX = center[0];
  const centerY = center[1];

  const tip = [
    centerX + Math.sin(headingRad) * coneLength,
    centerY + Math.cos(headingRad) * coneLength
  ];

  const left = [
    centerX + Math.sin(leftRad) * coneLength * 0.75,
    centerY + Math.cos(leftRad) * coneLength * 0.75
  ];

  const right = [
    centerX + Math.sin(rightRad) * coneLength * 0.75,
    centerY + Math.cos(rightRad) * coneLength * 0.75
  ];

  return new ol.geom.Polygon([[center, left, tip, right, center]]);
}

function updateHeadingCone() {
  if (
    !mapInitialized ||
    !headingSource ||
    !currentUserMapCoords ||
    currentHeading === null
  ) {
    return;
  }

  headingSource.clear();

  headingSource.addFeature(
    new ol.Feature({
      geometry: createHeadingCone(currentUserMapCoords, currentHeading),
      type: "heading"
    })
  );
}

async function calculateRouteToPoi(poiFeature) {
  const routeText = document.getElementById("route-text");

  try {
    selectedPoiFeature = poiFeature;

    if (routeText) {
      routeText.textContent = "Route wird berechnet ...";
    }

    if (!currentUserLonLat) {
      await getUserLocation();
    }

    const startLon = currentUserLonLat[0];
    const startLat = currentUserLonLat[1];

    const endLon = poiFeature.get("lon");
    const endLat = poiFeature.get("lat");
    const poiName = poiFeature.get("name");

    const routeProfile = document.getElementById("route-profile");
    const selectedProfile = routeProfile ? routeProfile.value : "foot";

    const profileConfig = {
      car: {
        serverPath: "routed-car",
        apiProfile: "driving",
        label: "Auto"
      },
      bike: {
        serverPath: "routed-bike",
        apiProfile: "driving",
        label: "Fahrrad"
      },
      foot: {
        serverPath: "routed-foot",
        apiProfile: "driving",
        label: "Fuß"
      }
    };

    const profile = profileConfig[selectedProfile] || profileConfig.foot;

    const osrmUrl =
      `https://routing.openstreetmap.de/${profile.serverPath}/route/v1/${profile.apiProfile}/` +
      `${startLon},${startLat};${endLon},${endLat}` +
      `?overview=full&geometries=geojson&steps=false`;

    const response = await fetch(osrmUrl);

    if (!response.ok) {
      throw new Error("Der Routingdienst konnte nicht erreicht werden.");
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error("Für diesen POI konnte keine Route berechnet werden.");
    }

    const route = data.routes[0];

    const routeCoordinates = route.geometry.coordinates.map(coord =>
      transformCoords(coord[0], coord[1])
    );

    const routeFeature = new ol.Feature({
      geometry: new ol.geom.LineString(routeCoordinates),
      type: "route"
    });

    if (routeSource) {
      routeSource.clear();
      routeSource.addFeature(routeFeature);
    }

    if (routeText) {
      routeText.innerHTML = `
        Verkehrsmittel: ${profile.label}<br>
        Ziel: ${poiName}<br>
        Entfernung: ${formatDistance(route.distance)}<br>
        Dauer: ca. ${formatDuration(route.duration)}
      `;
    }

    if (map) {
      map.getView().fit(routeFeature.getGeometry().getExtent(), {
        padding: [90, 320, 120, 80],
        duration: 700,
        maxZoom: 17
      });
    }
  } catch (error) {
    if (routeText) {
      routeText.textContent = error.message;
    }
  }
}

function switchView(mode) {
  const isMapMode = mode === "map";

  document.body.classList.toggle("map-mode", isMapMode);

  if (arViewButton) {
    arViewButton.classList.toggle("active", !isMapMode);
  }

  if (mapViewButton) {
    mapViewButton.classList.toggle("active", isMapMode);
  }

  if (isMapMode) {
    initializeMap();

    window.setTimeout(function () {
      if (map) {
        map.updateSize();
      }
    }, 50);
  } else {
    startCameraAndLocation();
  }
}

function initializeApp() {
  scene = document.querySelector("#ar-scene");
  cameraVideo = document.querySelector("#camera-video");
  cameraRig = document.querySelector("#cameraRig");

  statusEl = document.querySelector("#status");
  poiListEl = document.querySelector("#poiList");

  arViewButton = document.querySelector("#arViewButton");
  mapViewButton = document.querySelector("#mapViewButton");
  cameraStartButton = document.querySelector("#cameraStartButton");

  registerFaceCameraComponent();
  initializeAFrameContent();

  if (arViewButton) {
    arViewButton.addEventListener("click", function () {
      switchView("ar");
    });
  }

  if (mapViewButton) {
    mapViewButton.addEventListener("click", function () {
      switchView("map");
    });
  }

  if (cameraStartButton) {
    cameraStartButton.textContent = "Kamera und Standort starten";

    cameraStartButton.addEventListener("click", function () {
      startCameraAndLocation();
    });
  }

  setStatus("Tippe auf „Kamera und Standort starten“.");
}

window.addEventListener("load", initializeApp);
