//Creating the Map
var map = L.map('map', {
  zoomAnimation: true,
  markerZoomAnimation: true,
  attributionControl: false,
  maxZoom: 6,
}).setView([0, 0], 4);

var tiles = L.tileLayer('map/{z}/{x}/{y}.jpg', {
  continuousWorld: false,
  noWrap: true,
  minZoom: 2,
  maxZoom: 6,
  maxNativeZoom: 6,
}).addTo(map);

(function configureMarkedFootnotes() {
  var placeholderPrefix = '§§FOOTNOTE_REF_';
  var placeholderSuffix = '_END§§';
  var isRenderingFootnoteContent = false;

  function escapeForRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function createPlaceholder(label) {
    return (
      placeholderPrefix +
      encodeURIComponent(label) +
      placeholderSuffix
    );
  }

  function createFootnoteExtension() {
    var currentState = null;
    var placeholderPattern = new RegExp(
      escapeForRegex(placeholderPrefix) +
        '([^]+?)' +
        escapeForRegex(placeholderSuffix),
      'g'
    );

    function extractFootnoteDefinitions(lines) {
      var definitions = Object.create(null);
      var cleaned = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var match = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
        if (!match) {
          cleaned.push(line);
          continue;
        }

        var label = match[1].trim();
        var text = match[2] || '';
        var contentLines = [];
        if (text) {
          contentLines.push(text);
        }

        var j = i + 1;
        while (j < lines.length) {
          var continuation = lines[j];
          var contMatch = continuation.match(/^( {4}|\t)(.*)$/);
          if (contMatch) {
            contentLines.push(contMatch[2]);
            j += 1;
            continue;
          }
          if (continuation.trim() === '') {
            var nextLine = lines[j + 1];
            if (nextLine && /^( {4}|\t)/.test(nextLine)) {
              contentLines.push('');
              j += 1;
              continue;
            }
          }
          break;
        }
        definitions[label] = contentLines.join('\n').trim();
        i = j - 1;
      }
      return { cleaned: cleaned, definitions: definitions };
    }

    return {
      hooks: {
        preprocess: function (markdown) {
          if (isRenderingFootnoteContent) {
            return markdown;
          }

          var lines = markdown.split(/\r?\n/);
          var extracted = extractFootnoteDefinitions(lines);
          var definitions = extracted.definitions;
          var refOrder = [];
          var refIndex = Object.create(null);
          var refCounts = Object.create(null);

          var cleanedMarkdown = extracted.cleaned.join('\n').replace(/\[\^([^\]]+)\]/g, function (match, rawLabel) {
            var label = rawLabel.trim();
            if (!label) {
              return match;
            }
            if (!Object.prototype.hasOwnProperty.call(refIndex, label)) {
              refOrder.push(label);
              refIndex[label] = refOrder.length;
            }
            return createPlaceholder(label);
          });

          currentState = {
            definitions: definitions,
            refOrder: refOrder,
            refIndex: refIndex,
            refCounts: refCounts,
          };

          return cleanedMarkdown;
        },
        postprocess: function (html) {
          if (isRenderingFootnoteContent) {
            return html;
          }

          var state = currentState;
          currentState = null;

          if (!state) {
            return html;
          }

          html = html.replace(placeholderPattern, function (_, encodedLabel) {
            var label = decodeURIComponent(encodedLabel);
            var index = state.refIndex[label];
            if (!index) {
              state.refOrder.push(label);
              index = state.refOrder.length;
              state.refIndex[label] = index;
            }
            var count = state.refCounts[label] || 0;
            count += 1;
            state.refCounts[label] = count;
            var refId = 'fnref-' + index + (count > 1 ? '-' + count : '');
            var footnoteId = 'fn-' + index;
            return (
              '<sup class="footnote-ref" id="' +
              refId +
              '"><a href="#' +
              footnoteId +
              '">[' +
              index +
              ']</a></sup>'
            );
          });

          if (!state.refOrder.length) {
            return html;
          }

          var itemsHtml = state.refOrder
            .map(function (label, idx) {
              var index = idx + 1;
              var raw = state.definitions[label] || '';
              var contentHtml = raw;
              if (raw) {
                isRenderingFootnoteContent = true;
                try {
                  if (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function') {
                    contentHtml = marked.parse(raw);
                  } else if (typeof marked === 'function') {
                    contentHtml = marked(raw);
                  }
                } finally {
                  isRenderingFootnoteContent = false;
                }
              }
              var footnoteId = 'fn-' + index;
              return '<li id="' + footnoteId + '">' + contentHtml + '</li>';
            })
            .join('');

          if (itemsHtml) {
            html += '<section class="footnotes"><ol>' + itemsHtml + '</ol></section>';
          }

          return html;
        },
      },
    };
  }

  function applyExtension() {
    if (typeof marked === 'undefined' || !marked || typeof marked.use !== 'function') {
      return false;
    }
    if (applyExtension.applied) {
      return true;
    }
    marked.use(createFootnoteExtension());
    applyExtension.applied = true;
    return true;
  }

  if (!applyExtension()) {
    var scriptNodes = Array.prototype.slice.call(
      document && document.getElementsByTagName
        ? document.getElementsByTagName('script')
        : []
    );
    var markedScripts = scriptNodes.filter(function (node) {
      if (!node || !node.src) {
        return false;
      }
      return /marked(?:\.min)?\.js(?:$|[?#])/.test(node.src);
    });
    var pollId = null;

    function cleanup() {
      if (pollId !== null) {
        clearInterval(pollId);
        pollId = null;
      }
      document.removeEventListener('DOMContentLoaded', onReady);
      window.removeEventListener('load', onReady);
      if (markedScripts) {
        markedScripts.forEach(function (node) {
          if (node && typeof node.removeEventListener === 'function') {
            node.removeEventListener('load', onReady);
          }
        });
        markedScripts = null;
      }
    }

    function onReady() {
      if (applyExtension()) {
        cleanup();
      }
    }

    markedScripts.forEach(function (node) {
      if (node && typeof node.addEventListener === 'function') {
        node.addEventListener('load', onReady);
      }
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
    window.addEventListener('load', onReady);

    pollId = window.setInterval(function () {
      if (applyExtension()) {
        cleanup();
      }
    }, 50);
  }
})();
function textLabelsMatch(a, b) {
  if (!a || !b) return false;
  var textA = (a.text || '').trim();
  var textB = (b.text || '').trim();
  if (textA !== textB) return false;
  var altNamesA =
    a.altNames === undefined || a.altNames === null
      ? ''
      : String(a.altNames).trim();
  var altNamesB =
    b.altNames === undefined || b.altNames === null
      ? ''
      : String(b.altNames).trim();
  if (altNamesA !== altNamesB) return false;
  var subheaderA =
    a.subheader === undefined || a.subheader === null
      ? ''
      : String(a.subheader).trim();
  var subheaderB =
    b.subheader === undefined || b.subheader === null
      ? ''
      : String(b.subheader).trim();
  if (subheaderA !== subheaderB) return false;
  var overlayA = a.overlay || '';
  var overlayB = b.overlay || '';
  if (overlayA !== overlayB) return false;
  var latA = Number(a.lat);
  var latB = Number(b.lat);
  var lngA = Number(a.lng);
  var lngB = Number(b.lng);
  if (!isFinite(latA) || !isFinite(latB) || !isFinite(lngA) || !isFinite(lngB)) {
    return false;
  }
  return Math.abs(latA - latB) < 1e-6 && Math.abs(lngA - lngB) < 1e-6;
}

function containsTextLabel(collection, candidate) {
  return collection.some(function (item) {
    return textLabelsMatch(item, candidate);
  });
}

tiles.once('load', function () {
  baseZoom = map.getZoom();
  rescaleIcons();
  rescaleTextLabels();
});

var mouseCoords = document.getElementById('mouse-coords');

map.on('mousemove', function (e) {
  mouseCoords.textContent = e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4);
});

map.on('mouseout', function () {
  mouseCoords.textContent = '';
});

// Remove default marker shadows
L.Icon.Default.mergeOptions({
  shadowUrl: null,
  shadowSize: null,
  shadowAnchor: null,
});

var ICON_SCALE_FACTOR = 2;

function createScaledIcon(options) {
  var scaled = Object.assign({}, options);

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function toArray(value, duplicateNumber) {
    if (Array.isArray(value)) {
      return value.slice();
    }
    if (
      value &&
      typeof value === 'object' &&
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y)
    ) {
      return [value.x, value.y];
    }
    if (duplicateNumber && isFiniteNumber(value)) {
      return [value, value];
    }
    return null;
  }

  function scaleSizeComponent(rawValue) {
    if (!isFiniteNumber(rawValue)) {
      return rawValue;
    }
    if (rawValue <= 0) {
      return 0;
    }
    var scaledValue = rawValue * ICON_SCALE_FACTOR;
    var rounded = Math.round(scaledValue);
    return Math.max(1, rounded);
  }

  function scaleAnchorComponent(rawValue, rawDimension, scaledDimension, index) {
    if (!isFiniteNumber(rawValue)) {
      return rawValue;
    }

    var scaled;
    if (
      isFiniteNumber(rawDimension) &&
      rawDimension !== 0 &&
      isFiniteNumber(scaledDimension)
    ) {
      var ratio = rawValue / rawDimension;
      scaled = ratio * scaledDimension;
    } else {
      scaled = rawValue * ICON_SCALE_FACTOR;
    }

    var rounded = Math.round(scaled);
    if (rounded === 0 && rawValue !== 0) {
      rounded = rawValue > 0 ? 1 : -1;
    }
    if (index === 1) {
      if (rawValue > 0) {
        rounded = Math.max(1, rounded);
      } else if (rawValue < 0) {
        rounded = Math.min(-1, rounded);
      }
    }
    return rounded;
  }

  var rawIconSize = toArray(options.iconSize, true);
  var rawShadowSize = toArray(options.shadowSize, true);

  var scaledIconSize = null;
  if (rawIconSize) {
    scaledIconSize = rawIconSize.map(function (component) {
      return scaleSizeComponent(component);
    });
    scaled.iconSize = scaledIconSize;
  }

  var scaledShadowSize = null;
  if (rawShadowSize) {
    scaledShadowSize = rawShadowSize.map(function (component) {
      return scaleSizeComponent(component);
    });
    scaled.shadowSize = scaledShadowSize;
  }

  function applyAnchorScaling(key, rawValues, rawDimensions, scaledDimensions) {
    var rawArray = toArray(rawValues, true);
    if (!rawArray) {
      return;
    }
    scaled[key] = rawArray.map(function (rawValue, index) {
      var rawDimension = Array.isArray(rawDimensions) ? rawDimensions[index] : undefined;
      var scaledDimension = Array.isArray(scaledDimensions) ? scaledDimensions[index] : undefined;
      return scaleAnchorComponent(rawValue, rawDimension, scaledDimension, index);
    });
  }

  applyAnchorScaling('iconAnchor', options.iconAnchor, rawIconSize, scaledIconSize);
  applyAnchorScaling('shadowAnchor', options.shadowAnchor, rawShadowSize, scaledShadowSize);
  applyAnchorScaling('popupAnchor', options.popupAnchor, rawIconSize, scaledIconSize);
  applyAnchorScaling('tooltipAnchor', options.tooltipAnchor, rawIconSize, scaledIconSize);

  return L.icon(scaled);
}

function showInfo(title, altNames, subheader, description) {
  var panel = document.getElementById('info-panel');
  document.getElementById('info-title').textContent = title;
  var altNamesElement = document.getElementById('info-alt-names');
  if (altNamesElement) {
    var hasAltNames =
      typeof altNames === 'string' ? altNames.trim() !== '' : Boolean(altNames);
    if (hasAltNames) {
      altNamesElement.textContent = String(altNames);
      altNamesElement.classList.remove('hidden');
    } else {
      altNamesElement.textContent = '';
      altNamesElement.classList.add('hidden');
    }
  }
  var subheaderElement = document.getElementById('info-subheader');
  if (subheaderElement) {
    var hasSubheader =
      typeof subheader === 'string' ? subheader.trim() !== '' : Boolean(subheader);
    if (hasSubheader) {
      subheaderElement.textContent = String(subheader);
      subheaderElement.classList.remove('hidden');
    } else {
      subheaderElement.textContent = '';
      subheaderElement.classList.add('hidden');
    }
  }
  var markdown = '';
  if (typeof description === 'string') {
    markdown = description;
  } else if (description) {
    markdown = String(description);
  }
  var rendered = markdown;
  if (typeof marked !== 'undefined' && marked) {
    if (typeof marked.parse === 'function') {
      rendered = marked.parse(markdown);
    } else if (typeof marked === 'function') {
      rendered = marked(markdown);
    }
  }
  var sanitizeConfig = {
    ADD_TAGS: ['section', 'sup', 'ol', 'li', 'a', 'img'],
    ADD_ATTR: ['id', 'href', 'src', 'alt', 'title'],
  };
  var html = rendered;
  if (typeof DOMPurify !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
    html = DOMPurify.sanitize(rendered, sanitizeConfig);
  }
  document.getElementById('info-description').innerHTML = html;
  panel.classList.remove('hidden');
}

document.getElementById('close-info').addEventListener('click', function () {
  document.getElementById('info-panel').classList.add('hidden');
  clearSelectedMarker();
});

map.on('click', function () {
  document.getElementById('info-panel').classList.add('hidden');
  clearSelectedMarker();
});

var WigwamIcon = createScaledIcon({
  iconUrl: 'icons/wigwam.png',
  iconRetinaUrl: 'icons/wigwam.png',
  iconSize: [1.875, 1.875],
  iconAnchor: [0.9375, 1.875],
  popupAnchor: [0.1875, -1.875],
  tooltipAnchor: [0.9375, -0.9375],
});

var SettlementsIcon = createScaledIcon({
  iconUrl: 'icons/settlement.png',
  iconRetinaUrl: 'icons/settlement.png',
  iconSize: [2.8125, 2.8125],
  iconAnchor: [1.3125, 2.8125],
  popupAnchor: [0.1875, -2.8125],
  tooltipAnchor: [1.3125, -1.3125],
});

var CapitalIcon = createScaledIcon({
  iconUrl: 'icons/capital.png',
  iconRetinaUrl: 'icons/capital.png',
  iconSize: [1.875, 1.875],
  iconAnchor: [0.9375, 1.875],
  popupAnchor: [0.1875, -1.875],
  tooltipAnchor: [0.9375, -0.9375],
});

var RockIcon = createScaledIcon({
  iconUrl: 'icons/rock.png',
  iconRetinaUrl: 'icons/rock.png',
  iconSize: [1.875, 1.875],
  iconAnchor: [0.9375, 1.875],
  popupAnchor: [0.1875, -1.875],
  tooltipAnchor: [0.9375, -0.9375],
});

var fishingIconPath = 'icons/fish.png';
var FishingIcon = createScaledIcon({
  iconUrl: fishingIconPath,
  iconRetinaUrl: fishingIconPath,
  // Preserve the original aspect ratio of the fish icon (25x11)
  iconSize: [4.26, 1.875],
  iconAnchor: [2.13, 1.875],
  popupAnchor: [0.1875, -1.875],
  tooltipAnchor: [2.13, -0.9375],
});

var AgricultureIcon = createScaledIcon({
  iconUrl: 'icons/plantinggrounds.png',
  iconRetinaUrl: 'icons/plantinggrounds.png',
  iconSize: [1.875, 1.875],
  iconAnchor: [0.9375, 1.875],
  popupAnchor: [0.1875, -1.875],
  tooltipAnchor: [0.9375, -0.9375],
});

var PteroglyphIcon = createScaledIcon({
  iconUrl: 'icons/petrogliph.png',
  iconRetinaUrl: 'icons/petrogliph.png',
  iconSize: [1.875, 1.875],
  iconAnchor: [0.9375, 1.875],
  popupAnchor: [0.1875, -1.875],
  tooltipAnchor: [0.9375, -0.9375],
});

var MineIcon = createScaledIcon({
  iconUrl: 'icons/mine.png',
  iconRetinaUrl: 'icons/mine.png',
  iconSize: [1.875, 1.875],
  iconAnchor: [0.9375, 1.875],
  popupAnchor: [0.1875, -1.875],
  tooltipAnchor: [0.9375, -0.9375],
});

// Preserve the native aspect ratio of the wide Earthworks illustration while
// keeping the shared marker height for consistent scaling.

var earthworksIconHeight = 1.875 / 2;
var earthworksIconWidth = (685 / 227) * earthworksIconHeight;

var EarthworksIcon = createScaledIcon({
  iconUrl: 'icons/earthworks.png',
  iconRetinaUrl: 'icons/earthworks.png',
  iconSize: [earthworksIconWidth, earthworksIconHeight],
  iconAnchor: [earthworksIconWidth / 2, earthworksIconHeight],
  popupAnchor: [0, -earthworksIconHeight],
  tooltipAnchor: [earthworksIconWidth / 2, -earthworksIconHeight / 2],
});

// Preserve the original 39x17 aspect ratio of the fort icon while keeping the
// consistent marker height used throughout the map.
var fortIconHeight = 1.875;
var fortIconWidth = (39 / 17) * fortIconHeight;

var FortsIcon = createScaledIcon({
  iconUrl: 'icons/fort.png',
  iconRetinaUrl: 'icons/fort.png',
  iconSize: [fortIconWidth, fortIconHeight],
  iconAnchor: [fortIconWidth / 2, fortIconHeight],
  popupAnchor: [0.3, -fortIconHeight],
  tooltipAnchor: [fortIconWidth / 2, -fortIconHeight / 2],
});

var ChambersIcon = createScaledIcon({
  iconUrl: 'icons/csl.png',
  iconRetinaUrl: 'icons/csl.png',
  iconSize: [1.875, 1.875],
  iconAnchor: [0.9375, 1.875],
  popupAnchor: [0.1875, -1.875],
  tooltipAnchor: [0.9375, -0.9375],
});

var CampsIcon = createScaledIcon({
  iconUrl: 'icons/fire.png',
  iconRetinaUrl: 'icons/fire.png',
  iconSize: [0.9375, 0.9375],
  iconAnchor: [0.46875, 0.9375],
  popupAnchor: [0.09375, -0.9375],
  tooltipAnchor: [0.46875, -0.46875],
});

var seaMonsterIconHeight = 2.8125;
var seaMonsterIconWidth = (391 / 530) * seaMonsterIconHeight;

var SeaMonsterIcon = createScaledIcon({
  iconUrl: 'icons/seamonster.png',
  iconRetinaUrl: 'icons/seamonster.png',
  iconSize: [seaMonsterIconWidth, seaMonsterIconHeight],
  iconAnchor: [seaMonsterIconWidth / 2, seaMonsterIconHeight],
  popupAnchor: [0.1875, -seaMonsterIconHeight],
  tooltipAnchor: [seaMonsterIconWidth / 2, -seaMonsterIconHeight / 2],
});


// Map of icon keys to actual icons
var iconMap = {
  wigwam: WigwamIcon,
  settlement: SettlementsIcon,
  capital: CapitalIcon,
  rock: RockIcon,
  fishing: FishingIcon,
  agriculture: AgricultureIcon,
  pteroglyph: PteroglyphIcon,
  mine: MineIcon,
  earthworks: EarthworksIcon,
  forts: FortsIcon,
  chambers: ChambersIcon,
  seamonster: SeaMonsterIcon,
  camps: CampsIcon,
};

// Store custom marker data and marker instances
var customMarkers = [];
var customTextLabels = [];
var customPolygons = [];
var allMarkers = [];
var allTextLabels = [];
var baseZoom;
var selectedMarker = null;
var markerClipboardData = null;
var markerClipboardType = null;
var territoriesLayer = L.featureGroup();
var territoryMarkersLayer = L.layerGroup();
var Settlements = L.layerGroup();
var territoriesOverlay = L.layerGroup([territoriesLayer, territoryMarkersLayer]);
// Text labels use a bold sans-serif stack; mirror it when measuring glyph widths.
var TEXT_LABEL_FONT_FAMILY = "Roboto, 'Open Sans', 'Helvetica Neue', Arial, sans-serif";
var textMeasurementContext = null;
var textMeasurementSpan = null;

Settlements.addTo(map);
territoriesOverlay.addTo(map);

var overlayTargetGroups = {
  Settlements: Settlements,
  Territories: territoryMarkersLayer,
};

var overlays = {
  Settlements: Settlements,
  Territories: territoriesOverlay,
};

var additionalOverlayNames = [
  'Ceremonial Stone Landscapes',
  'Mountains',
  'Rivers',
  'Bodies of Water',
  'Planting Grounds',
  'Fishing Weirs',
  'Mines/Quarries',
  'Geographical Locations',
  'Tribes',
  'Petroglyph',
  'Trails',
  'Forts',
];

additionalOverlayNames.forEach(function (name) {
  var layer = L.layerGroup().addTo(map);
  overlayTargetGroups[name] = layer;
  overlays[name] = layer;
});

function populateOverlayOptions(select) {
  if (!select) return;
  select.innerHTML = '';
  var defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'None';
  select.appendChild(defaultOption);
  Object.keys(overlayTargetGroups).forEach(function (name) {
    var option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
}

function populateOverlaySelects() {
  populateOverlayOptions(document.getElementById('marker-overlay'));
  populateOverlayOptions(document.getElementById('text-overlay'));
}

populateOverlaySelects();
L.control.layers(null, overlays).addTo(map);

function clearSelectedMarker() {
  if (selectedMarker && selectedMarker._icon) {
    selectedMarker._icon.classList.remove('marker-selected');
  }
  selectedMarker = null;
}

function isTextualInput(element) {
  if (!element) return false;
  var tagName = element.tagName ? element.tagName.toLowerCase() : '';
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  return Boolean(element.isContentEditable);
}

function shouldIgnoreClipboardShortcut(event) {
  var target = event.target;
  if (isTextualInput(target)) {
    return true;
  }
  if (typeof document !== 'undefined') {
    var active = document.activeElement;
    if (active && active !== target && isTextualInput(active)) {
      return true;
    }
  }
  return false;
}

function cloneMarkerData(data) {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (err) {
    return null;
  }
}

// When pasting a marker/text label, position it at the centre of the
// current viewport so the pasted element is immediately visible to the user.
function offsetLatLngForPaste(lat, lng) {
  if (!map || typeof map.getCenter !== 'function') {
    return { lat: lat, lng: lng };
  }
  try {
    var center = map.getCenter();
    if (
      center &&
      typeof center.lat === 'number' &&
      typeof center.lng === 'number' &&
      isFinite(center.lat) &&
      isFinite(center.lng)
    ) {
      return { lat: center.lat, lng: center.lng };
    }
  } catch (err) {
    // Fall back to the original coordinates if we cannot read the map center.
  }
  return { lat: lat, lng: lng };
}

function highlightMarker(marker) {
  if (!marker) return;
  function applyHighlight() {
    if (marker._icon) {
      marker._icon.classList.add('marker-selected');
    }
  }
  if (marker._icon) {
    applyHighlight();
  } else if (typeof marker.once === 'function') {
    marker.once('add', applyHighlight);
  }
  selectedMarker = marker;
}

function rescaleIcons() {
  if (baseZoom === undefined) {
    baseZoom = map.getZoom();
  }
  var scale = Math.pow(2, map.getZoom() - baseZoom);

  function scaleSizeComponent(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return value;
    }
    if (value <= 0) {
      return 0;
    }
    var rounded = Math.round(value * scale);
    return Math.max(1, rounded);
  }

  function scaleOffsetComponent(baseValue, baseDimension, scaledDimension, minAbs) {
    if (typeof baseValue !== 'number' || !isFinite(baseValue)) {
      return baseValue;
    }

    var scaled;
    if (
      typeof baseDimension === 'number' &&
      isFinite(baseDimension) &&
      baseDimension !== 0 &&
      typeof scaledDimension === 'number' &&
      isFinite(scaledDimension)
    ) {
      var ratio = baseValue / baseDimension;
      scaled = ratio * scaledDimension;
    } else {
      scaled = baseValue * scale;
    }

    var rounded = Math.round(scaled);
    if (rounded === 0 && baseValue !== 0) {
      rounded = baseValue > 0 ? 1 : -1;
    }

    if (minAbs) {
      if (baseValue > 0) {
        rounded = Math.max(minAbs, rounded);
      } else if (baseValue < 0) {
        rounded = Math.min(-minAbs, rounded);
      }
    }

    return rounded;
  }

  allMarkers.forEach(function (m) {
    var base = m._baseIconOptions;
    if (!base) {
      return;
    }
    var opts = Object.assign({}, base);
    var baseIconSize = Array.isArray(base.iconSize) ? base.iconSize.slice() : null;
    var scaledIconSize = null;
    if (baseIconSize) {
      scaledIconSize = baseIconSize.map(scaleSizeComponent);
      opts.iconSize = scaledIconSize;
    }

    if (Array.isArray(base.iconAnchor)) {
      var scaledAnchor;
      if (scaledIconSize) {
        scaledAnchor = [
          scaleOffsetComponent(base.iconAnchor[0], baseIconSize[0], scaledIconSize[0]),
          scaleOffsetComponent(base.iconAnchor[1], baseIconSize[1], scaledIconSize[1], 1),
        ];
      } else {
        scaledAnchor = base.iconAnchor.map(function (value, index) {
          return scaleOffsetComponent(value, null, null, index === 1 ? 1 : 0);
        });
      }
      opts.iconAnchor = scaledAnchor;
    }

    var baseShadowSize = Array.isArray(base.shadowSize) ? base.shadowSize.slice() : null;
    var scaledShadowSize = null;
    if (baseShadowSize) {
      scaledShadowSize = baseShadowSize.map(scaleSizeComponent);
      opts.shadowSize = scaledShadowSize;
    }

    if (Array.isArray(base.shadowAnchor)) {
      var shadowAnchor;
      if (scaledShadowSize) {
        shadowAnchor = [
          scaleOffsetComponent(base.shadowAnchor[0], baseShadowSize[0], scaledShadowSize[0]),
          scaleOffsetComponent(base.shadowAnchor[1], baseShadowSize[1], scaledShadowSize[1], 1),
        ];
      } else {
        shadowAnchor = base.shadowAnchor.map(function (value, index) {
          return scaleOffsetComponent(value, null, null, index === 1 ? 1 : 0);
        });
      }
      opts.shadowAnchor = shadowAnchor;
    }

    if (Array.isArray(base.popupAnchor)) {
      var popupAnchor = base.popupAnchor.map(function (value, index) {
        var baseDimension = baseIconSize ? baseIconSize[index] : null;
        var scaledDimension = scaledIconSize ? scaledIconSize[index] : null;
        return scaleOffsetComponent(value, baseDimension, scaledDimension, index === 1 ? 1 : 0);
      });
      opts.popupAnchor = popupAnchor;
    }

    if (Array.isArray(base.tooltipAnchor)) {
      var tooltipAnchor = base.tooltipAnchor.map(function (value, index) {
        var baseDimension = baseIconSize ? baseIconSize[index] : null;
        var scaledDimension = scaledIconSize ? scaledIconSize[index] : null;
        return scaleOffsetComponent(value, baseDimension, scaledDimension, index === 1 ? 1 : 0);
      });
      opts.tooltipAnchor = tooltipAnchor;
    }
    m.setIcon(L.icon(opts));
  });
}

function rescaleTextLabels() {
  if (baseZoom === undefined) {
    baseZoom = map.getZoom();
  }
  var scale = Math.pow(2, map.getZoom() - baseZoom);
  allTextLabels.forEach(function (m) {
    if (m._icon) {
      var inner = m._icon.querySelector('.text-label__inner');
      if (!inner) {
        return;
      }
      inner.style.transformOrigin = 'top left';
      inner.style.transform = 'scale(' + scale + ')';
    }
  });
}
function rescaleTextLabels() {
  if (baseZoom === undefined) {
    baseZoom = map.getZoom();
  }
  var scale = Math.pow(2, map.getZoom() - baseZoom);
  allTextLabels.forEach(function (m) {
    if (m._icon) {
      var span = m._icon.querySelector('span');
      if (span) {
        span.style.fontSize = m._baseFontSize * scale + 'px';
        span.style.letterSpacing = (m._baseLetterSpacing || 0) * scale + 'px';
      } else {
        var svg = m._icon.querySelector('svg');
        if (svg) {
          var text = svg.querySelector('text');
          if (text) {
            text.style.fontSize = m._baseFontSize * scale + 'px';
            text.style.letterSpacing = (m._baseLetterSpacing || 0) * scale + 'px';
          }
          if (m._baseSvgWidth) {
            var scaledSvgWidth = m._baseSvgWidth * scale;
            svg.setAttribute('width', scaledSvgWidth);
            svg.style.width = scaledSvgWidth + 'px';
          }
          if (m._baseSvgHeight || m._baseFontSize) {
            var baseHeight = m._baseSvgHeight || m._baseFontSize;
            var scaledSvgHeight = baseHeight * scale;
            svg.setAttribute('height', scaledSvgHeight);
            svg.style.height = scaledSvgHeight + 'px';
          }
          if (m._baseCurve) {
            var path = svg.querySelector('path');
            if (path) {
              var width = (m._basePathWidth || 0) * scale;
              var r = Math.abs(m._baseCurve) * scale;
              var sweep = m._baseCurve > 0 ? 0 : 1;
              path.setAttribute('d', 'M0,0 A' + r + ',' + r + ' 0 0,' + sweep + ' ' + width + ',0');
            }
          }
        }
      }
    }
  });
}

// Parse a single CSV row into an array of values
function parseCsvRow(line) {
  var result = [];
  var cur = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  result.push(cur);
  return result;
}

// Convert the CSV text into feature objects
function loadFeaturesFromCSV(text) {
  var markers = [];
  var textLabels = [];
  var polygons = [];
  var source = (text || '').trim();
  if (!source) {
    return { markers: markers, textLabels: textLabels, polygons: polygons };
  }

  var rows = [];
  var current = '';
  var inQuotes = false;

  for (var i = 0; i < source.length; i++) {
    var ch = source[i];
    if (ch === '"') {
      if (inQuotes) {
        if (source[i + 1] === '"') {
          current += '""';
          i += 1;
        } else {
          inQuotes = false;
          current += ch;
        }
      } else {
        inQuotes = true;
        current += ch;
      }
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      rows.push(current);
      current = '';
      if (ch === '\r' && source[i + 1] === '\n') {
        i += 1;
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0 || rows.length === 0) {
    rows.push(current);
  }

  rows.slice(1).forEach(function (line) {
    if (!line.trim()) return;
    var cols = parseCsvRow(line);
    var type = cols[0];
    if (type === 'marker') {
      markers.push({
        lat: parseFloat(cols[1]),
        lng: parseFloat(cols[2]),
        icon: cols[3] || 'wigwam',
        name: cols[4],
        altNames: cols[5] || '',
        subheader: cols[6] || '',
        description: cols[7],
        style: cols[13] ? JSON.parse(cols[13]) : undefined,
        overlay: cols[14] || '',
      });
    } else if (type === 'text') {
      textLabels.push({
        lat: parseFloat(cols[1]),
        lng: parseFloat(cols[2]),
        text: cols[4],
        altNames: cols[5] || '',
        subheader: cols[6] || '',
        description: cols[7],
        size: parseFloat(cols[8]) || 14,
        angle: parseFloat(cols[9]) || 0,
        spacing: parseFloat(cols[10]) || 0,
        curve: parseFloat(cols[11]) || 0,
        overlay: cols[14] || '',
      });
    } else if (type === 'polygon') {
      polygons.push({
        name: cols[4],
        description: cols[7],
        coords: cols[12] ? JSON.parse(cols[12]) : [],
        style: cols[13] ? JSON.parse(cols[13]) : undefined,
      });
    }
  });
  return { markers: markers, textLabels: textLabels, polygons: polygons };
}

function escapeCsvValue(val) {
  if (val === undefined || val === null) return '';
  var str = String(val).replace(/"/g, '""');
  return /[",\n]/.test(str) ? '"' + str + '"' : str;
}

function buildFeaturesCSV() {
  var rows = [
    'type,lat,lng,icon,name/text,alt_names,subheader/text,description,size,angle,spacing,curve,coords,style,overlay'
  ];

  customMarkers.forEach(function (m) {
    rows.push(
      [
        'marker',
        escapeCsvValue(m.lat),
        escapeCsvValue(m.lng),
        escapeCsvValue(m.icon),
        escapeCsvValue(m.name),
        escapeCsvValue(m.altNames || ''),
        escapeCsvValue(m.subheader || ''),
        escapeCsvValue(m.description),
        '',
        '',
        '',
        '',
        '',
        escapeCsvValue(JSON.stringify(m.style || {})),
        escapeCsvValue(m.overlay || '')
      ].join(',')
    );
  });

  customTextLabels.forEach(function (t) {
    rows.push(
      [
        'text',
        escapeCsvValue(t.lat),
        escapeCsvValue(t.lng),
        '',
        escapeCsvValue(t.text),
        escapeCsvValue(t.altNames || ''),
        escapeCsvValue(t.subheader || ''),
        escapeCsvValue(t.description),
        escapeCsvValue(t.size),
        escapeCsvValue(t.angle),
        escapeCsvValue(t.spacing),
        escapeCsvValue(t.curve),
        '',
        '',
        escapeCsvValue(t.overlay || '')
      ].join(',')
    );
  });

  customPolygons.forEach(function (p) {
    rows.push(
      [
        'polygon',
        '',
        '',
        '',
        escapeCsvValue(p.name),
        '',
        '',
        escapeCsvValue(p.description),
        '',
        '',
        '',
        '',
        escapeCsvValue(JSON.stringify(p.coords)),
        escapeCsvValue(JSON.stringify(p.style || {})),
        ''
      ].join(',')
    );
  });

  return rows.join('\n');
}

function encodeCsvToBase64(csvContent) {
  if (typeof TextEncoder !== 'undefined') {
    var encoder = new TextEncoder();
    var bytes = encoder.encode(csvContent);
    var binary = '';
    bytes.forEach(function (b) {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }
  var escaped = encodeURIComponent(csvContent).replace(/%([0-9A-F]{2})/g, function (match, p1) {
    return String.fromCharCode(parseInt(p1, 16));
  });
  return btoa(escaped);
}

function sendFeaturesCsvToServer(csvContent) {
  var encodedContent = encodeCsvToBase64(csvContent);
  return fetch('/save-features', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: encodedContent })
  }).then(function (response) {
    if (!response.ok) {
      throw new Error('Server rejected save');
    }
  });
}

function triggerCsvDownload(csvContent) {
  var blob = new Blob([csvContent], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'features.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function exportFeaturesToCSV() {
  var csvContent = buildFeaturesCSV();
  sendFeaturesCsvToServer(csvContent).catch(function () {
    triggerCsvDownload(csvContent);
  });
}

function saveMarkers() {
  updateEditToolbar();
}

function saveTextLabels() {
  updateEditToolbar();
  var csvContent = buildFeaturesCSV();
  
}

function savePolygons() {
  updateEditToolbar();
}

function updateEditToolbar() {
  if (drawControl && drawControl._toolbars && drawControl._toolbars.edit) {
    drawControl._toolbars.edit._checkDisabled();
  }
}

function setPolygonPopup(poly) {
  var data = poly._data;
  var isCustom = customPolygons.includes(data);
  var html =
    '<b>' +
    (data.name || '') +
    '</b>' +
    (data.description ? '<br>' + data.description : '');
  if (isCustom) {
    html += '<br><a href="#" class="polygon-edit-link">Edit</a>';
  }
  poly.bindPopup(html);
  poly.off('popupopen');
  poly.on('popupopen', function (e) {
    var link = e.popup._contentNode.querySelector('.polygon-edit-link');
    if (link) {
      link.addEventListener('click', function (ev) {
        ev.preventDefault();
        editPolygonForm(poly);
      });
    }
  });
}

function editPolygonForm(poly) {
  if (!poly || !poly._data) return;
  var data = poly._data;
  var name = prompt('Enter territory name:', data.name || 'Territory') || data.name;
  var description = prompt('Enter description:', data.description || '') || data.description;
  var color =
    prompt('Enter hex color for polygon:', (data.style && data.style.color) || '#3388ff') ||
    (data.style && data.style.color) ||
    '#3388ff';
  data.name = name;
  data.description = description;
  data.style = { color: color, fillColor: color, fillOpacity: 0.3 };
  poly.setStyle(data.style);
  setPolygonPopup(poly);
  if (customPolygons.includes(data)) {
    savePolygons();
  }
}

function addPolygonToMap(data) {
  var opts = Object.assign(
    {
      color: '#3388ff',
      weight: 2,
      fillColor: '#3388ff',
      fillOpacity: 0.3,
    },
    data.style || {}
  );
  var poly = L.polygon(data.coords, opts).addTo(territoriesLayer);
  poly._data = data;
  setPolygonPopup(poly);
  poly.on('contextmenu', function () {
    territoriesLayer.removeLayer(poly);
    customPolygons = customPolygons.filter(function (p) {
      return p !== data;
    });
    savePolygons();
    updateEditToolbar();
  });
  updateEditToolbar();
  return poly;
}

function getOverlayLayer(name) {
  if (!name) return null;
  return overlayTargetGroups[name] || null;
}

function moveMarkerToOverlay(marker, overlayName) {
  if (!marker) return;
  var normalized = overlayName || '';
  var newLayer = getOverlayLayer(normalized);
  var currentLayer = marker._overlayLayer || null;
  var currentName = marker._overlayName || '';
  if (currentLayer === newLayer && currentName === normalized) {
    marker._overlayName = normalized;
    if (marker._data) {
      marker._data.overlay = normalized;
    }
    return;
  }
  if (currentLayer) {
    currentLayer.removeLayer(marker);
  } else if (marker._overlayLayer !== undefined) {
    map.removeLayer(marker);
  }
  if (newLayer) {
    newLayer.addLayer(marker);
  } else {
    marker.addTo(map);
  }
  marker._overlayLayer = newLayer;
  marker._overlayName = normalized;
  if (marker._data) {
    marker._data.overlay = normalized;
  }
}

function detachMarker(marker) {
  if (!marker) return;
  if (marker._overlayLayer) {
    marker._overlayLayer.removeLayer(marker);
  } else {
    map.removeLayer(marker);
  }
  marker._overlayLayer = null;
  marker._overlayName = '';
}

function moveTextLabelToOverlay(labelMarker, overlayName) {
  if (!labelMarker) return;
  var normalized = overlayName || '';
  var newLayer = getOverlayLayer(normalized);
  var currentLayer = labelMarker._overlayLayer || null;
  var currentName = labelMarker._overlayName || '';
  if (currentLayer === newLayer && currentName === normalized) {
    labelMarker._overlayName = normalized;
    if (labelMarker._data) {
      labelMarker._data.overlay = normalized;
    }
    return;
  }
  if (currentLayer) {
    currentLayer.removeLayer(labelMarker);
  } else if (labelMarker._overlayLayer !== undefined) {
    map.removeLayer(labelMarker);
  }
  if (newLayer) {
    newLayer.addLayer(labelMarker);
  } else {
    labelMarker.addTo(map);
  }
  labelMarker._overlayLayer = newLayer || null;
  labelMarker._overlayName = normalized;
  if (labelMarker._data) {
    labelMarker._data.overlay = normalized;
  }
}

function detachTextLabel(labelMarker) {
  if (!labelMarker) return;
  if (labelMarker._overlayLayer) {
    labelMarker._overlayLayer.removeLayer(labelMarker);
  } else {
    map.removeLayer(labelMarker);
  }
  labelMarker._overlayLayer = null;
  labelMarker._overlayName = '';
}

function addMarkerToMap(data) {
  var icon = iconMap[data.icon] || WigwamIcon;
  if (data.subheader === undefined || data.subheader === null) {
    data.subheader = '';
  }
  if (data.altNames === undefined || data.altNames === null) {
    data.altNames = '';
  }
  var customMarker = createMarker(
    data.lat,
    data.lng,
    icon,
    data.name,
    data.altNames,
    data.subheader,
    data.description
  );
  var overlayName = data.overlay || '';
  var targetLayer = getOverlayLayer(overlayName);
  if (targetLayer) {
    targetLayer.addLayer(customMarker);
  } else {
    customMarker.addTo(map);
  }
  customMarker._overlayLayer = targetLayer || null;
  customMarker._overlayName = overlayName;
  data.overlay = overlayName;
  customMarker._data = data;
  customMarker.on('contextmenu', function () {
    detachMarker(customMarker);
    customMarkers = customMarkers.filter(function (m) {
      return !(
        m.lat === data.lat &&
        m.lng === data.lng &&
        m.name === data.name &&
        (m.altNames || '') === (data.altNames || '') &&
        (m.subheader || '') === (data.subheader || '')
      );
    });
    saveMarkers();
  });
  rescaleIcons();
  return customMarker;
}

// Use an offscreen canvas to avoid forcing synchronous DOM layout when measuring curved text.
function getTextMeasurementContext() {
  if (textMeasurementContext) {
    return textMeasurementContext;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  textMeasurementContext = ctx;
  return textMeasurementContext;
}

// Fallback DOM-based measurement used if the canvas API is unavailable.
function getTextMeasurementSpan() {
  if (textMeasurementSpan && textMeasurementSpan.parentNode) {
    return textMeasurementSpan;
  }
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }
  var span = document.createElement('span');
  span.className = 'text-label__measure';
  span.style.position = 'absolute';
  span.style.visibility = 'hidden';
  span.style.whiteSpace = 'pre';
  span.style.pointerEvents = 'none';
  span.style.left = '-9999px';
  span.style.top = '-9999px';
  span.style.fontFamily = TEXT_LABEL_FONT_FAMILY;
  span.style.fontWeight = 'bold';
  document.body.appendChild(span);
  textMeasurementSpan = span;
  return textMeasurementSpan;
}

// Approximate the rendered width of curved text so we can size the supporting SVG path.
function measureCurvedTextWidth(text, fontSize, letterSpacing) {
  if (!text) {
    return 0;
  }
  var value = String(text);
  var sizeValue = parseFloat(fontSize);
  if (!Number.isFinite(sizeValue) || sizeValue <= 0) {
    return 0;
  }
  var spacingValue = parseFloat(letterSpacing);
  if (!Number.isFinite(spacingValue)) {
    spacingValue = 0;
  }
  var width = 0;
  var ctx = getTextMeasurementContext();
  if (ctx) {
    var font = 'bold ' + sizeValue + 'px ' + TEXT_LABEL_FONT_FAMILY;
    if (ctx.font !== font) {
      ctx.font = font;
    }
    var metrics = ctx.measureText ? ctx.measureText(value) : null;
    if (metrics && typeof metrics.width === 'number') {
      width = metrics.width;
    }
    if (spacingValue) {
      width += spacingValue * Math.max(0, value.length - 1);
    }
  }
  if (!Number.isFinite(width) || width <= 0) {
    var span = getTextMeasurementSpan();
    if (!span) {
      width = 0;
    } else {
      span.style.fontSize = sizeValue + 'px';
      span.style.letterSpacing = spacingValue + 'px';
      span.textContent = value;
      var rect = span.getBoundingClientRect();
      width = rect && rect.width ? rect.width : 0;
    }
  }
  if (!Number.isFinite(width) || width < 0) {
    width = 0;
  }
  return width;
}

function addTextLabelToMap(data) {
  if (data.subheader === undefined || data.subheader === null) {
    data.subheader = '';
  }
  if (data.altNames === undefined || data.altNames === null) {
    data.altNames = '';
  }
  if (data.spacing === undefined) data.spacing = 0;
  var textIcon;
  var pathWidth = 0;
  var baseSvgWidth = null;
  var baseSvgHeight = null;
  if (data.curve) {
    pathWidth = measureCurvedTextWidth(data.text, data.size, data.spacing);
    var r = Math.abs(data.curve);
    var sweep = data.curve > 0 ? 0 : 1;
    var pathId = 'text-curve-' + Date.now() + Math.random().toString(36).slice(2);
    var d = 'M0,0 A' + r + ',' + r + ' 0 0,' + sweep + ' ' + pathWidth + ',0';
    var fontSizeValue = parseFloat(data.size);
    if (!Number.isFinite(fontSizeValue) || fontSizeValue <= 0) {
      fontSizeValue = 1;
    }
    var svgWidth = Math.max(pathWidth, 1);
    var svgHeight = Math.max(fontSizeValue, 1);
    baseSvgWidth = svgWidth;
    baseSvgHeight = svgHeight;
    var svgHtml =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      svgWidth +
      '" height="' +
      svgHeight +
      '" style="overflow: visible; transform: rotate(' +
      (data.angle || 0) +
      'deg);"><path id="' +
      pathId +
      '" d="' +
      d +
      '" fill="none"></path><text style="font-size:' +
      data.size +
      'px; letter-spacing:' +
      data.spacing +
      'px;"><textPath href="#' +
      pathId +
      '">' +
      data.text +
      '</textPath></text></svg>';
    var curvedHtml = '<div class="text-label__inner">' + svgHtml + '</div>';
    textIcon = L.divIcon({ className: 'text-label', html: curvedHtml, iconAnchor: [0, 0] });
  } else {
    var spanHtml =
      '<span style="font-size:' +
      data.size +
      'px; letter-spacing:' +
      data.spacing +
      'px; transform: rotate(' +
      (data.angle || 0) +
      'deg);">' +
      data.text +
      '</span>';
    var straightHtml = '<div class="text-label__inner">' + spanHtml + '</div>';
    textIcon = L.divIcon({
      className: 'text-label',
      html: straightHtml,
      iconAnchor: [0, 0],
    });
  }
  var m = L.marker([data.lat, data.lng], { icon: textIcon, draggable: true });
  m
    .on('click', function (ev) {
      L.DomEvent.stopPropagation(ev);
      clearSelectedMarker();
      if (this._icon) {
        this._icon.classList.add('marker-selected');
        selectedMarker = this;
      }
      showInfo(data.text, data.altNames, data.subheader, data.description);
    })
    .on('dblclick', function (ev) {
      L.DomEvent.stopPropagation(ev);
      editTextForm(m);
    })
    .on('dragend', function () {
      if (m._data) {
        var pos = m.getLatLng();
        m._data.lat = pos.lat;
        m._data.lng = pos.lng;
        saveTextLabels();
      }
    })
    .on('contextmenu', function () {
      detachTextLabel(m);
      customTextLabels = customTextLabels.filter(function (t) {
        return !(
          t.lat === data.lat &&
          t.lng === data.lng &&
          t.text === data.text &&
          (t.altNames || '') === (data.altNames || '') &&
          t.size === data.size &&
          t.description === data.description &&
          t.angle === data.angle &&
          t.spacing === data.spacing &&
          (t.curve || 0) === (data.curve || 0)
        );
      });
      allTextLabels = allTextLabels.filter(function (t) {
        return t !== m;
      });
      saveTextLabels();
    });
  var overlayName = data.overlay || '';
  var targetLayer = getOverlayLayer(overlayName);
  if (targetLayer) {
    targetLayer.addLayer(m);
  } else {
    m.addTo(map);
  }
  m._overlayLayer = targetLayer || null;
  m._overlayName = overlayName;
  data.overlay = overlayName;
  m._baseFontSize = data.size;
  m._baseLetterSpacing = data.spacing;
  if (data.curve) {
    m._baseCurve = data.curve;
    m._basePathWidth = pathWidth;
    m._baseSvgWidth = baseSvgWidth;
    m._baseSvgHeight = baseSvgHeight;
  } else {
    m._baseSvgWidth = null;
    m._baseSvgHeight = null;
  }
  m._data = data;
  m._markerType = 'text';
  allTextLabels.push(m);
  rescaleTextLabels();
  return m;
}

fetch('data/features.csv')
  .then(function (r) {
    return r.text();
  })
  .then(function (csv) {
    try {
      var parsed = loadFeaturesFromCSV(csv);
      parsed.markers.forEach(function (m) {
        customMarkers.push(m);
        addMarkerToMap(m);
      });
      parsed.textLabels.forEach(function (t) {
        if (containsTextLabel(customTextLabels, t)) {
          return;
        }
        customTextLabels.push(t);
        addTextLabelToMap(t);
      });
      parsed.polygons.forEach(function (p) {
        customPolygons.push(p);
        addPolygonToMap(p);
      });
    } catch (err) {
      throw err;
    }
  })
  .catch(function (err) {
    console.error('Failed to load features.csv', err);
  });


// //// START OF MARKERS
// 1. Marker declarations
function createMarker(lat, lng, icon, name, altNames, subheader, description) {
  var m = L.marker([lat, lng], { icon: icon, draggable: true })
    .on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      clearSelectedMarker();
      if (this._icon) {
        this._icon.classList.add('marker-selected');
        selectedMarker = this;
      }
      var d =
        this._data || {
          name: name,
          altNames: altNames,
          subheader: subheader,
          description: description,
        };
      showInfo(d.name, d.altNames, d.subheader, d.description);
    })
    .on('dragend', function () {
      if (m._data) {
        var pos = m.getLatLng();
        m._data.lat = pos.lat;
        m._data.lng = pos.lng;
        saveMarkers();
      }
    })
    .on('dblclick', function (e) {
      L.DomEvent.stopPropagation(e);
      if (m._data) {
        editMarkerForm(m);
      }
    });
  m._markerType = 'marker';
  m._baseIconOptions = JSON.parse(JSON.stringify(icon.options));
  allMarkers.push(m);
  return m;
}
// ******END OF MARKERS DECLARATION ******

map.on('zoomend', rescaleIcons);
map.on('zoomend', rescaleTextLabels);

document.addEventListener('keydown', function (event) {
  if (event.defaultPrevented) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  var key = (event.key || '').toLowerCase();
  if (key !== 'c' && key !== 'v') return;
  if (shouldIgnoreClipboardShortcut(event)) return;

  if (key === 'c') {
    if (typeof window !== 'undefined' && window.getSelection) {
      var selection = window.getSelection().toString();
      if (selection) {
        return;
      }
    }
    if (!selectedMarker || !selectedMarker._data) return;
    var cloned = cloneMarkerData(selectedMarker._data);
    if (!cloned) return;
    markerClipboardData = cloned;
    markerClipboardType = selectedMarker._markerType === 'text' ? 'text' : 'marker';
  } else if (key === 'v') {
    if (!markerClipboardData) return;
    var pasteData = cloneMarkerData(markerClipboardData);
    if (!pasteData) return;
    var lat = parseFloat(pasteData.lat);
    var lng = parseFloat(pasteData.lng);
    if (isFinite(lat) && isFinite(lng)) {
      var offset = offsetLatLngForPaste(lat, lng);
      pasteData.lat = offset.lat;
      pasteData.lng = offset.lng;
    }
    var newMarker;
    if (markerClipboardType === 'text') {
      newMarker = addTextLabelToMap(pasteData);
      customTextLabels.push(pasteData);
      saveTextLabels();
    } else {
      newMarker = addMarkerToMap(pasteData);
      customMarkers.push(pasteData);
      saveMarkers();
    }
    clearSelectedMarker();
    highlightMarker(newMarker);
  }
});

function showPolygonForm(tempLayer) {
  var overlay = document.getElementById('polygon-form-overlay');
  var saveBtn = document.getElementById('polygon-save');
  var cancelBtn = document.getElementById('polygon-cancel');
  overlay.classList.remove('hidden');

  function submitHandler() {
    var name = document.getElementById('polygon-name').value || 'Territory';
    var description = document.getElementById('polygon-description').value || '';
    var color = document.getElementById('polygon-color').value || '#3388ff';
    var coords = tempLayer.getLatLngs()[0].map(function (latlng) {
      return [latlng.lat, latlng.lng];
    });
    var data = {
      name: name,
      description: description,
      coords: coords,
      style: { color: color, fillColor: color, fillOpacity: 0.3 },
    };
    customPolygons.push(data);
    addPolygonToMap(data);
    savePolygons();
    map.removeLayer(tempLayer);
    cleanup();
  }

  function cancelHandler() {
    map.removeLayer(tempLayer);
    cleanup();
  }

  function cleanup() {
    overlay.classList.add('hidden');
    saveBtn.removeEventListener('click', submitHandler);
    cancelBtn.removeEventListener('click', cancelHandler);
    document.getElementById('polygon-name').value = '';
    document.getElementById('polygon-description').value = '';
    document.getElementById('polygon-color').value = '#3388ff';
  }

  saveBtn.addEventListener('click', submitHandler);
  cancelBtn.addEventListener('click', cancelHandler);
}

function showMarkerForm(latlng) {
  var overlay = document.getElementById('marker-form-overlay');
  var saveBtn = document.getElementById('marker-save');
  var cancelBtn = document.getElementById('marker-cancel');
  var convertBtn = document.getElementById('marker-convert');
  var overlaySelect = document.getElementById('marker-overlay');
  overlay.classList.remove('hidden');
  convertBtn.classList.add('hidden');
  if (overlaySelect) {
    overlaySelect.value = '';
  }
  document.getElementById('marker-alt-names').value = '';
  document.getElementById('marker-subheader').value = '';

  function submitHandler() {
    var name = document.getElementById('marker-name').value || 'Marker';
    var altNames = document.getElementById('marker-alt-names').value || '';
    var subheader = document.getElementById('marker-subheader').value || '';
    var description =
      document.getElementById('marker-description').value || '';
    var iconKey = document.getElementById('marker-icon').value || 'wigwam';
    var overlayValue = overlaySelect ? overlaySelect.value : '';
    var data = {
      lat: latlng.lat,
      lng: latlng.lng,
      name: name,
      altNames: altNames,
      subheader: subheader,
      description: description,
      icon: iconKey,
      overlay: overlayValue || '',
    };
    addMarkerToMap(data);
    customMarkers.push(data);
    saveMarkers();
    cleanup();
  }

  function cancelHandler() {
    cleanup();
  }

  function cleanup() {
    overlay.classList.add('hidden');
    saveBtn.removeEventListener('click', submitHandler);
    cancelBtn.removeEventListener('click', cancelHandler);
    convertBtn.classList.add('hidden');
    document.getElementById('marker-name').value = '';
    document.getElementById('marker-alt-names').value = '';
    document.getElementById('marker-subheader').value = '';
    document.getElementById('marker-description').value = '';
    document.getElementById('marker-icon').value = 'wigwam';
    if (overlaySelect) {
      overlaySelect.value = '';
    }
  }

  saveBtn.addEventListener('click', submitHandler);
  cancelBtn.addEventListener('click', cancelHandler);
}

function editMarkerForm(marker) {
  if (!marker || !marker._data) return;
  var overlay = document.getElementById('marker-form-overlay');
  var saveBtn = document.getElementById('marker-save');
  var cancelBtn = document.getElementById('marker-cancel');
  var convertBtn = document.getElementById('marker-convert');
  var title = document.querySelector('#marker-form h3');
  var overlaySelect = document.getElementById('marker-overlay');
  overlay.classList.remove('hidden');
  convertBtn.classList.remove('hidden');

  document.getElementById('marker-name').value = marker._data.name || '';
  document.getElementById('marker-alt-names').value = marker._data.altNames || '';
  document.getElementById('marker-subheader').value = marker._data.subheader || '';
  document.getElementById('marker-description').value = marker._data.description || '';
  document.getElementById('marker-icon').value = marker._data.icon || 'wigwam';
  if (overlaySelect) {
    overlaySelect.value = marker._data.overlay || '';
  }
  if (title) title.textContent = 'Edit Marker';

  function submitHandler() {
    var name = document.getElementById('marker-name').value || 'Marker';
    var altNames = document.getElementById('marker-alt-names').value || '';
    var subheader = document.getElementById('marker-subheader').value || '';
    var description = document.getElementById('marker-description').value || '';
    var iconKey = document.getElementById('marker-icon').value || 'wigwam';
    var overlayValue = overlaySelect ? overlaySelect.value : '';

    marker._data.name = name;
    marker._data.altNames = altNames;
    marker._data.subheader = subheader;
    marker._data.description = description;
    marker._data.icon = iconKey;

    var newIcon = iconMap[iconKey] || WigwamIcon;
    marker.setIcon(newIcon);
    marker._baseIconOptions = JSON.parse(JSON.stringify(newIcon.options));
    moveMarkerToOverlay(marker, overlayValue);
    rescaleIcons();
    saveMarkers();
    cleanup();
  }

  function cancelHandler() {
    cleanup();
  }

  function convertHandler() {
    cleanup();
    convertMarkerToText(marker);
  }

  function cleanup() {
    overlay.classList.add('hidden');
    saveBtn.removeEventListener('click', submitHandler);
    cancelBtn.removeEventListener('click', cancelHandler);
    convertBtn.removeEventListener('click', convertHandler);
    document.getElementById('marker-name').value = '';
    document.getElementById('marker-alt-names').value = '';
    document.getElementById('marker-subheader').value = '';
    document.getElementById('marker-description').value = '';
    document.getElementById('marker-icon').value = 'wigwam';
    if (overlaySelect) {
      overlaySelect.value = '';
    }
    convertBtn.classList.add('hidden');
    if (title) title.textContent = 'Add Marker';
  }

  saveBtn.addEventListener('click', submitHandler);
  cancelBtn.addEventListener('click', cancelHandler);
  convertBtn.addEventListener('click', convertHandler);
}

var AddMarkerControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function (map) {
    var container = L.DomUtil.create('div', 'leaflet-bar');
    var link = L.DomUtil.create('a', '', container);
    link.id = 'add-marker-btn';
    link.href = '#';
    link.title = 'Add Marker';
    link.innerHTML = '+';
    L.DomEvent.on(link, 'click', L.DomEvent.stopPropagation)
      .on(link, 'click', L.DomEvent.preventDefault)
      .on(link, 'click', function () {
        alert('Click on the map to place the marker.');
        map.once('click', function (e) {
          showMarkerForm(e.latlng);
        });
      });
    return container;
  },
});

map.addControl(new AddMarkerControl());

function showTextForm(latlng) {
  var overlay = document.getElementById('text-form-overlay');
  var saveBtn = document.getElementById('text-save');
  var cancelBtn = document.getElementById('text-cancel');
  var convertBtn = document.getElementById('text-convert');
  var overlaySelect = document.getElementById('text-overlay');
  overlay.classList.remove('hidden');
  convertBtn.classList.add('hidden');
  if (overlaySelect) {
    overlaySelect.value = '';
  }
  document.getElementById('text-label-alt-names').value = '';

  function submitHandler() {
    var text = document.getElementById('text-label-text').value || '';
    if (!text) {
      cleanup();
      return;
    }
    var altNames = document.getElementById('text-label-alt-names').value || '';
    var subheader = document.getElementById('text-label-subheader').value || '';
    var description = document.getElementById('text-label-description').value || '';
    var size = parseFloat(document.getElementById('text-label-size').value) || 14;
    var angle = parseFloat(document.getElementById('text-label-angle').value) || 0;
    var spacing = parseFloat(document.getElementById('text-letter-spacing').value) || 0;
    var curve = parseFloat(document.getElementById('text-curve-radius').value) || 0;
    var overlayValue = overlaySelect ? overlaySelect.value : '';
    var data = {
      lat: latlng.lat,
      lng: latlng.lng,
      text: text,
      altNames: altNames,
      subheader: subheader,
      description: description,
      size: size,
      angle: angle,
      spacing: spacing,
      curve: curve,
      overlay: overlayValue || '',
    };
    addTextLabelToMap(data);
    customTextLabels.push(data);
    saveTextLabels();
    cleanup();
  }

  function cancelHandler() {
    cleanup();
  }

  function cleanup() {
    overlay.classList.add('hidden');
    saveBtn.removeEventListener('click', submitHandler);
    cancelBtn.removeEventListener('click', cancelHandler);
    convertBtn.classList.add('hidden');
    document.getElementById('text-label-text').value = '';
    document.getElementById('text-label-alt-names').value = '';
    document.getElementById('text-label-subheader').value = '';
    document.getElementById('text-label-description').value = '';
    document.getElementById('text-label-size').value = '14';
    document.getElementById('text-label-angle').value = '0';
    document.getElementById('text-letter-spacing').value = '0';
    document.getElementById('text-curve-radius').value = '0';
    if (overlaySelect) {
      overlaySelect.value = '';
    }
  }

  saveBtn.addEventListener('click', submitHandler);
  cancelBtn.addEventListener('click', cancelHandler);
}

function editTextForm(labelMarker) {
  if (!labelMarker || !labelMarker._data) return;
  var overlay = document.getElementById('text-form-overlay');
  var saveBtn = document.getElementById('text-save');
  var cancelBtn = document.getElementById('text-cancel');
  var convertBtn = document.getElementById('text-convert');
  var overlaySelect = document.getElementById('text-overlay');
  var data = labelMarker._data;

  document.getElementById('text-label-text').value = data.text || '';
  document.getElementById('text-label-alt-names').value = data.altNames || '';
  document.getElementById('text-label-subheader').value = data.subheader || '';
  document.getElementById('text-label-description').value = data.description || '';
  document.getElementById('text-label-size').value = data.size || 14;
  document.getElementById('text-label-angle').value = data.angle || 0;
  document.getElementById('text-letter-spacing').value = data.spacing || 0;
  document.getElementById('text-curve-radius').value = data.curve || 0;
  if (overlaySelect) {
    overlaySelect.value = data.overlay || '';
  }
  overlay.classList.remove('hidden');
  convertBtn.classList.remove('hidden');

  function submitHandler() {
    var text = document.getElementById('text-label-text').value || '';
    if (!text) {
      cleanup();
      return;
    }
    var subheader = document.getElementById('text-label-subheader').value || '';
    var altNames = document.getElementById('text-label-alt-names').value || '';
    var description = document.getElementById('text-label-description').value || '';
    var size = parseFloat(document.getElementById('text-label-size').value) || 14;
    var angle = parseFloat(document.getElementById('text-label-angle').value) || 0;
    var spacing = parseFloat(document.getElementById('text-letter-spacing').value) || 0;
    var curve = parseFloat(document.getElementById('text-curve-radius').value) || 0;
    var overlayValue = overlaySelect ? overlaySelect.value : '';

    var textIcon;
    var pathWidth = 0;
    if (curve) {
      pathWidth = measureCurvedTextWidth(text, size, spacing);
      var r = Math.abs(curve);
      var sweep = curve > 0 ? 0 : 1;
      var pathId = 'text-curve-' + Date.now() + Math.random().toString(36).slice(2);
      var d = 'M0,0 A' + r + ',' + r + ' 0 0,' + sweep + ' ' + pathWidth + ',0';
      var svgHtml =
        '<svg xmlns="http://www.w3.org/2000/svg" style="transform: rotate(' +
        angle +
        'deg);"><path id="' +
        pathId +
        '" d="' +
        d +
        '" fill="none"></path><text style="font-size:' +
        size +
        'px; letter-spacing:' +
        spacing +
        'px;"><textPath href="#' +
        pathId +
        '">' +
        text +
        '</textPath></text></svg>';
      var curvedHtml = '<div class="text-label__inner">' + svgHtml + '</div>';
      textIcon = L.divIcon({ className: 'text-label', html: curvedHtml, iconAnchor: [0, 0] });
    } else {
      var spanHtml =
        '<span style="font-size:' +
        size +
        'px; letter-spacing:' +
        spacing +
        'px; transform: rotate(' +
        angle +
        'deg);">' +
        text +
        '</span>';
      var straightHtml = '<div class="text-label__inner">' + spanHtml + '</div>';
      textIcon = L.divIcon({
        className: 'text-label',
        html: straightHtml,
        iconAnchor: [0, 0],
      });
    }
    labelMarker.setIcon(textIcon);
    labelMarker._baseFontSize = size;
    labelMarker._baseLetterSpacing = spacing;
    data.text = text;
    data.altNames = altNames;
    data.subheader = subheader;
    data.description = description;
    data.size = size;
    data.angle = angle;
    data.spacing = spacing;
    data.curve = curve;
    moveTextLabelToOverlay(labelMarker, overlayValue);
    saveTextLabels();
    rescaleTextLabels();
    cleanup();
  }

  function cancelHandler() {
    cleanup();
  }

  function convertHandler() {
    cleanup();
    convertTextToMarker(labelMarker);
  }

  function cleanup() {
    overlay.classList.add('hidden');
    saveBtn.removeEventListener('click', submitHandler);
    cancelBtn.removeEventListener('click', cancelHandler);
    convertBtn.removeEventListener('click', convertHandler);
    convertBtn.classList.add('hidden');
    document.getElementById('text-label-text').value = '';
    document.getElementById('text-label-alt-names').value = '';
    document.getElementById('text-label-subheader').value = '';
    document.getElementById('text-label-description').value = '';
    document.getElementById('text-label-size').value = '14';
    document.getElementById('text-label-angle').value = '0';
    document.getElementById('text-letter-spacing').value = '0';
    document.getElementById('text-curve-radius').value = '0';
    if (overlaySelect) {
      overlaySelect.value = '';
    }
  }

  saveBtn.addEventListener('click', submitHandler);
  cancelBtn.addEventListener('click', cancelHandler);
  convertBtn.addEventListener('click', convertHandler);
}

function convertMarkerToText(marker) {
  if (!marker || !marker._data) return;
  if (selectedMarker === marker) {
    selectedMarker = null;
  }
  var data = marker._data;
  detachMarker(marker);
  customMarkers = customMarkers.filter(function (m) {
    return m !== data;
  });
  allMarkers = allMarkers.filter(function (m) {
    return m !== marker;
  });
  saveMarkers();

  var textData = {
    lat: data.lat,
    lng: data.lng,
    text: data.name || '',
    altNames: data.altNames || '',
    subheader: data.subheader || '',
    description: data.description || '',
    size: 14,
    angle: 0,
    spacing: 0,
    curve: 0,
    overlay: data.overlay || '',
  };
  customTextLabels.push(textData);
  var labelMarker = addTextLabelToMap(textData);
  saveTextLabels();
  editTextForm(labelMarker);
}

function convertTextToMarker(labelMarker) {
  if (!labelMarker || !labelMarker._data) return;
  if (selectedMarker === labelMarker) {
    selectedMarker = null;
  }
  var data = labelMarker._data;
  detachTextLabel(labelMarker);
  customTextLabels = customTextLabels.filter(function (t) {
    return t !== data;
  });
  allTextLabels = allTextLabels.filter(function (t) {
    return t !== labelMarker;
  });
  saveTextLabels();

  var markerData = {
    lat: data.lat,
    lng: data.lng,
    name: data.text || 'Marker',
    altNames: data.altNames || '',
    subheader: data.subheader || '',
    description: data.description || '',
    icon: 'wigwam',
    overlay: data.overlay || '',
  };
  customMarkers.push(markerData);
  var marker = addMarkerToMap(markerData);
  saveMarkers();
  editMarkerForm(marker);
}

// Control to add text labels
var AddTextControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function (map) {
    var container = L.DomUtil.create('div', 'leaflet-bar');
    var link = L.DomUtil.create('a', '', container);
    link.id = 'add-text-btn';
    link.href = '#';
    link.title = 'Add Text';
    link.innerHTML = 'T';
      L.DomEvent.on(link, 'click', L.DomEvent.stopPropagation)
        .on(link, 'click', L.DomEvent.preventDefault)
        .on(link, 'click', function () {
          alert('Click on the map to place the text.');
          map.once('click', function (e) {
            showTextForm(e.latlng);
          });
        });
      return container;
    },
  });

map.addControl(new AddTextControl());

var drawControl = new L.Control.Draw({
  draw: {
    polygon: true,
    polyline: false,
    rectangle: false,
    circle: false,
    circlemarker: false,
    marker: false,
  },
  edit: {
    featureGroup: territoriesLayer,
  },
});
map.addControl(drawControl);
updateEditToolbar();

map.on(L.Draw.Event.CREATED, function (e) {
  if (e.layerType === 'polygon') {
    showPolygonForm(e.layer);
  }
});

map.on(L.Draw.Event.EDITED, function (e) {
  e.layers.eachLayer(function (layer) {
    if (customPolygons.includes(layer._data)) {
      layer._data.coords = layer
        .getLatLngs()[0]
        .map(function (latlng) {
          return [latlng.lat, latlng.lng];
        });
    }
  });
  savePolygons();
});

map.on(L.Draw.Event.DELETED, function (e) {
  e.layers.eachLayer(function (layer) {
    if (customPolygons.includes(layer._data)) {
      customPolygons = customPolygons.filter(function (p) {
        return p !== layer._data;
      });
    }
  });
  savePolygons();
  updateEditToolbar();
});

document.getElementById('save-changes').addEventListener('click', function () {
  exportFeaturesToCSV();
});

(function setupCreditsPanel() {
  var creditsToggle = document.getElementById('credits-toggle');
  var creditsPanel = document.getElementById('credits-panel');
  if (!creditsToggle || !creditsPanel) {
    return;
  }

  var closeButton = document.getElementById('close-credits');
  var creditsContent = creditsPanel.querySelector('.credits-content');

  if (!closeButton || !creditsContent) {
    return;
  }

  function isPanelHidden() {
    return creditsPanel.classList.contains('hidden');
  }

  function openCredits() {
    if (!isPanelHidden()) {
      return;
    }
    creditsPanel.classList.remove('hidden');
    creditsPanel.setAttribute('aria-hidden', 'false');
    creditsToggle.setAttribute('aria-expanded', 'true');
    window.setTimeout(function () {
      creditsContent.focus();
    }, 0);
  }

  function closeCredits() {
    if (isPanelHidden()) {
      return;
    }
    creditsPanel.classList.add('hidden');
    creditsPanel.setAttribute('aria-hidden', 'true');
    creditsToggle.setAttribute('aria-expanded', 'false');
    window.setTimeout(function () {
      creditsToggle.focus();
    }, 0);
  }

  creditsToggle.addEventListener('click', function () {
    if (isPanelHidden()) {
      openCredits();
    } else {
      closeCredits();
    }
  });

  closeButton.addEventListener('click', function () {
    closeCredits();
  });

  creditsPanel.addEventListener('click', function (event) {
    if (event.target === creditsPanel) {
      closeCredits();
    }
  });

  creditsPanel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      closeCredits();
    }
  });
})();



