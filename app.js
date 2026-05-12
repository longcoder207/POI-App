// Beispiel-POIs: Ersetze diese Koordinaten durch deine echten POIs.
// Wichtig: Für sichtbare Tests sollten die POIs in deiner Nähe liegen.
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

const scene = document.querySelector("a-scene");
const statusEl = document.querySelector("#status");
const poiListEl = document.querySelector("#poiList");
const arViewButton = document.querySelector("#arViewButton");
const mapViewButton = document.querySelector("#mapViewButton");

let currentUserLonLat = null;
let currentUserMapCoords = null;
let currentHeading = null;
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

const toRad = value => value * Math.PI / 180;

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

function createPoiMarker(poi) {
  // Das gps-new-entity-place-Attribut sorgt dafür,
  // dass dieses Objekt im Kamerabild an der echten Geo-Position erscheint.
  const markerRoot = document.createElement("a-entity");
  markerRoot.setAttribute("id", poi.id);
  markerRoot.setAttribute(
    "gps-new-entity-place",
    `latitude: ${poi.latitude}; longitude: ${poi.longitude}`
  );

  // Pin-Kopf
  const pinHead = document.createElement("a-sphere");
  pinHead.setAttribute("radius", "5");
  pinHead.setAttribute("position", "0 12 0");
  pinHead.setAttribute("material", `color: ${poi.color}; opacity: 0.95`);

  // Pin-Spitze
  const pinTip = document.createElement("a-cone");
  pinTip.setAttribute("radius-bottom", "3");
  pinTip.setAttribute("radius-top", "0");
  pinTip.setAttribute("height", "9");
  pinTip.setAttribute("position", "0 5 0");
  pinTip.setAttribute("rotation", "180 0 0");
  pinTip.setAttribute("material", `color: ${poi.color}; opacity: 0.95`);

  // Text, der immer in Richtung Kamera schaut
  const label = document.createElement("a-text");
  label.setAttribute("id", `${poi.id}-label`);
  label.setAttribute("value", poi.name);
  label.setAttribute("align", "center");
  label.setAttribute("anchor", "center");
  label.setAttribute("baseline", "center");
  label.setAttribute("look-at", "[gps-new-camera]");
  label.setAttribute("scale", "16 16 16");
  label.setAttribute("position", "0 24 0");
  label.setAttribute("material", "color: white");

  // Leichte Animation, damit der POI im Kamerabild besser auffällt
  pinHead.setAttribute(
    "animation",
    "property: scale; dir: alternate; dur: 850; loop: true; to: 1.25 1.25 1.25"
  );

  markerRoot.appendChild(pinHead);
  markerRoot.appendChild(pinTip);
  markerRoot.appendChild(label);

  scene.appendChild(markerRoot);
}

function renderPois() {
  POIS.forEach(createPoiMarker);
}

function updatePoiDistances(position) {
  const { latitude, longitude, accuracy } = position.coords;

  currentUserLonLat = [longitude, latitude];

  statusEl.textContent = `Standort aktiv: ±${Math.round(accuracy)} m Genauigkeit`;

  const sortedPois = POIS
    .map(poi => ({
      ...poi,
      distance: distanceInMeters(latitude, longitude, poi.latitude, poi.longitude)
    }))
    .sort((a, b) => a.distance - b.distance);

  // Entfernung auch im AR-Textlabel aktualisieren
  sortedPois.forEach(poi => {
    const label = document.querySelector(`#${poi.id}-label`);
    if (label) {
      label.setAttribute("value", `${poi.name}\n${Math.round(poi.distance)} m`);
    }
  });

  // Kleine Liste oben als Orientierung
  poiListEl.innerHTML = sortedPois
    .map((poi, index) => {
      const className = index === 0 ? "poi-near" : "";
      return `<div class="${className}">${poi.name}: ${Math.round(poi.distance)} m</div>`;
    })
    .join("");

  updateMapLocation(longitude, latitude, accuracy);
}

function handleGeoError(error) {
  const messages = {
    1: "Standortzugriff wurde abgelehnt. Bitte im Browser erlauben.",
    2: "Standort konnte nicht bestimmt werden. Gehe möglichst nach draußen.",
    3: "Standortabfrage hat zu lange gedauert."
  };

  statusEl.textContent = messages[error.code] || "Unbekannter Standortfehler.";
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
  return POIS.map(poi => new ol.Feature({
    geometry: new ol.geom.Point(transformCoords(poi.longitude, poi.latitude)),
    name: poi.name,
    description: `POI aus der AR-App`,
    lon: poi.longitude,
    lat: poi.latitude,
    color: poi.color,
    type: "poi"
  }));
}

function initializeMap() {
  if (mapInitialized || typeof ol === "undefined") {
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
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attributions: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    })
  });

  topoLayer = new ol.layer.Tile({
    title: "Topografische Karte",
    type: "base",
    visible: false,
    source: new ol.source.XYZ({
      url: "https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attributions: "Kartendaten © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung © OpenTopoMap",
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
          fill: new ol.style.Fill({ color: feature.get("color") || "#dc2626" }),
          stroke: new ol.style.Stroke({ color: "#ffffff", width: 2 })
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
          stroke: new ol.style.Stroke({ color: "rgba(37, 99, 235, 0.7)", width: 2 }),
          fill: new ol.style.Fill({ color: "rgba(37, 99, 235, 0.15)" })
        });
      }

      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 9,
          fill: new ol.style.Fill({ color: "#2563eb" }),
          stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 })
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
      stroke: new ol.style.Stroke({ color: "rgba(245, 158, 11, 0.95)", width: 2 }),
      fill: new ol.style.Fill({ color: "rgba(245, 158, 11, 0.35)" })
    })
  });

  routeSource = new ol.source.Vector();
  const routeLayer = new ol.layer.Vector({
    title: "Route",
    visible: true,
    source: routeSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#16a34a", width: 5 })
    })
  });

  map = new ol.Map({
    target: "map",
    layers: [osmLayer, satelliteLayer, topoLayer, routeLayer, headingLayer, poiLayer, locationLayer],
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
    autoPan: { animation: { duration: 250 } }
  });

  map.addOverlay(popupOverlay);

  popupCloser.addEventListener("click", function () {
    popupOverlay.setPosition(undefined);
    popupCloser.blur();
  });

  map.on("singleclick", function (event) {
    const feature = map.forEachFeatureAtPixel(event.pixel, hitFeature => hitFeature);

    if (!feature) {
      popupOverlay.setPosition(undefined);
      return;
    }

    const name = feature.get("name");
    const description = feature.get("description");

    if (!name) {
      return;
    }

    popupContent.innerHTML = `<h3>${name}</h3><p>${description || ""}</p>`;

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

  window.setTimeout(() => map.updateSize(), 200);
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

  document.getElementById("poi-toggle").addEventListener("change", function () {
    poiLayer.setVisible(this.checked);
  });

  document.getElementById("location-toggle").addEventListener("change", function () {
    locationLayer.setVisible(this.checked);
  });

  document.getElementById("heading-toggle").addEventListener("change", function () {
    headingLayer.setVisible(this.checked);
  });

  document.getElementById("locate-button").addEventListener("click", showUserLocation);
  document.getElementById("heading-button").addEventListener("click", activateHeading);
  document.getElementById("route-profile").addEventListener("change", function () {
    if (selectedPoiFeature) {
      calculateRouteToPoi(selectedPoiFeature);
    }
  });
  document.getElementById("clear-route-button").addEventListener("click", function () {
    routeSource.clear();
    selectedPoiFeature = null;
    document.getElementById("route-text").textContent = "Wähle einen POI auf der Karte aus, um eine Route zu berechnen.";
  });
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
      map.getView().animate({
        center: location.coords,
        zoom: 17,
        duration: 700
      });

      popupContent.innerHTML = `<h3>Mein Standort</h3><p>Genauigkeit: ca. ${Math.round(location.accuracy)} Meter</p>`;
      popupOverlay.setPosition(location.coords);
    })
    .catch(function (error) {
      alert(error.message);
    });
}

function createHeadingCone(center, headingDegrees) {
  const coneLength = 80;
  const coneWidth = 35;

  const headingRad = (headingDegrees * Math.PI) / 180;
  const leftRad = ((headingDegrees - coneWidth / 2) * Math.PI) / 180;
  const rightRad = ((headingDegrees + coneWidth / 2) * Math.PI) / 180;

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
  if (!mapInitialized || !headingSource || !currentUserMapCoords || currentHeading === null) {
    return;
  }

  headingSource.clear();
  headingSource.addFeature(new ol.Feature({
    geometry: createHeadingCone(currentUserMapCoords, currentHeading),
    type: "heading"
  }));
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

function handleDeviceOrientation(event) {
  const heading = getHeadingFromEvent(event);

  if (heading === null) {
    return;
  }

  currentHeading = heading;
  updateHeadingCone();
}

async function activateHeading() {
  try {
    if (!window.DeviceOrientationEvent) {
      alert("Dieses Gerät unterstützt keine Geräteausrichtung.");
      return;
    }

    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();

      if (permission !== "granted") {
        alert("Berechtigung für die Blickrichtung wurde nicht erteilt.");
        return;
      }
    }

    window.addEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
    window.addEventListener("deviceorientation", handleDeviceOrientation, true);

    if (!currentUserMapCoords) {
      await getUserLocation();
    }

    alert("Blickrichtung wurde aktiviert.");
  } catch (error) {
    alert("Blickrichtung konnte nicht aktiviert werden.");
  }
}

async function calculateRouteToPoi(poiFeature) {
  const routeText = document.getElementById("route-text");

  try {
    selectedPoiFeature = poiFeature;
    routeText.textContent = "Route wird berechnet ...";

    if (!currentUserLonLat) {
      await getUserLocation();
    }

    const startLon = currentUserLonLat[0];
    const startLat = currentUserLonLat[1];
    const endLon = poiFeature.get("lon");
    const endLat = poiFeature.get("lat");
    const poiName = poiFeature.get("name");
    const selectedProfile = document.getElementById("route-profile").value;

    const profileConfig = {
      car: { serverPath: "routed-car", apiProfile: "driving", label: "Auto" },
      bike: { serverPath: "routed-bike", apiProfile: "driving", label: "Fahrrad" },
      foot: { serverPath: "routed-foot", apiProfile: "driving", label: "Fuß" }
    };

    const profile = profileConfig[selectedProfile];
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
    const routeCoordinates = route.geometry.coordinates.map(coord => transformCoords(coord[0], coord[1]));

    const routeFeature = new ol.Feature({
      geometry: new ol.geom.LineString(routeCoordinates),
      type: "route"
    });

    routeSource.clear();
    routeSource.addFeature(routeFeature);

    routeText.innerHTML = `
      Verkehrsmittel: ${profile.label}<br>
      Ziel: ${poiName}<br>
      Entfernung: ${formatDistance(route.distance)}<br>
      Dauer: ca. ${formatDuration(route.duration)}
    `;

    map.getView().fit(routeFeature.getGeometry().getExtent(), {
      padding: [90, 320, 120, 80],
      duration: 700,
      maxZoom: 17
    });
  } catch (error) {
    routeText.textContent = error.message;
  }
}

function switchView(mode) {
  const isMapMode = mode === "map";

  document.body.classList.toggle("map-mode", isMapMode);
  arViewButton.classList.toggle("active", !isMapMode);
  mapViewButton.classList.toggle("active", isMapMode);

  if (isMapMode) {
    initializeMap();
    window.setTimeout(() => map.updateSize(), 50);
  }
}

arViewButton.addEventListener("click", () => switchView("ar"));
mapViewButton.addEventListener("click", () => switchView("map"));

renderPois();

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(updatePoiDistances, handleGeoError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  });
} else {
  statusEl.textContent = "Dieses Gerät unterstützt keine Geolocation API.";
}

window.addEventListener("resize", function () {
  if (mapInitialized && map) {
    map.updateSize();
  }
});
