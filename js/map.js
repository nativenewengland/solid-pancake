//Creating the Map
var map = L.map('map', {
  zoomAnimation: true,
  markerZoomAnimation: false,
  attributionControl: false,
  minZoom: 3,
  maxZoom: 6,
  maxBoundsViscosity: 1.0,
}).setView([0, 0], 4);

var textPane = map.createPane('textPane');
if (textPane) {
  textPane.classList.add('text-label-pane');
}

var tiles = L.tileLayer('map/{z}/{x}/{y}.jpg', {
  continuousWorld: false,
  noWrap: true,
  minZoom: 3,
  maxZoom: 6,
  maxNativeZoom: 6,
}).addTo(map);

(function configureLeafletDefaultIcons() {
  if (typeof L === 'undefined' || !L || !L.Icon || !L.Icon.Default) {
    return;
  }

  function svgToDataUri(svg) {
    return (
      'data:image/svg+xml;charset=UTF-8,' +
      encodeURIComponent(svg).replace(/%0A/g, '').replace(/%20/g, ' ')
    );
  }

  var markerSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">' +
    '<path d="M12.5 1C6.148 1 1 6.214 1 12.68c0 6.85 8.676 21.086 10.676 24.304.174.284.48.456.824.456s.65-.172.824-.456C15.324 33.766 24 19.53 24 12.68 24 6.214 18.852 1 12.5 1z" fill="#2b7bc9" stroke="#123f6e" stroke-width="2"/>' +
    '<circle cx="12.5" cy="13" r="4.5" fill="#f7f7f2" stroke="#123f6e" stroke-width="1.5"/></svg>';
  var shadowSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="41" height="41" viewBox="0 0 41 41">' +
    '<ellipse cx="20.5" cy="34" rx="12" ry="7" fill="#000000" fill-opacity="0.35"/></svg>';

  var markerUri = svgToDataUri(markerSvg);
  var shadowUri = svgToDataUri(shadowSvg);

  if (typeof L.Icon.Default.mergeOptions === 'function') {
    L.Icon.Default.mergeOptions({
      iconUrl: markerUri,
      iconRetinaUrl: markerUri,
      shadowUrl: shadowUri,
    });
  }
})();

// Prevent the map from panning past the edge of the rendered image tiles.
(function constrainMapPanningToTiles() {
  var TILE_COORD_BOUNDS = {
    minX: 14,
    maxX: 49,
    minY: 10,
    maxY: 53,
    zoom: 6,
  };

  var tileSize = tiles.getTileSize();
  var sizeX = tileSize && typeof tileSize.x === 'number' ? tileSize.x : 256;
  var sizeY = tileSize && typeof tileSize.y === 'number' ? tileSize.y : sizeX;

  var southWest = map.unproject(
    [TILE_COORD_BOUNDS.minX * sizeX, (TILE_COORD_BOUNDS.maxY + 1) * sizeY],
    TILE_COORD_BOUNDS.zoom
  );
  var northEast = map.unproject(
    [(TILE_COORD_BOUNDS.maxX + 1) * sizeX, TILE_COORD_BOUNDS.minY * sizeY],
    TILE_COORD_BOUNDS.zoom
  );
  var bounds = L.latLngBounds(southWest, northEast);

  map.setMaxBounds(bounds);
  map.panInsideBounds(bounds, { animate: false });
})();

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
var ICON_SCALE_MIN = 0.01;
var ICON_SCALE_MAX = 2;
var MARKER_LABEL_BASE_FONT_SIZE = 12;
var MARKER_LABEL_BASE_PADDING_X = 8;
var MARKER_LABEL_BASE_PADDING_Y = 2;
var MARKER_LABEL_BASE_OFFSET_Y = 12;
var iconSizeSlider = null;
var iconSizeValueDisplay = null;
var wikiInfoPanel =
  typeof document !== 'undefined' ? document.getElementById('wiki-info') : null;
var wikiInfoDefault =
  typeof document !== 'undefined' ? document.getElementById('wiki-info-default') : null;
var wikiMarkerContainer =
  typeof document !== 'undefined' ? document.getElementById('wiki-marker-info') : null;
var wikiMarkerInfobox =
  typeof document !== 'undefined' ? document.getElementById('wiki-marker-infobox') : null;
var wikiMarkerTitle =
  typeof document !== 'undefined' ? document.getElementById('wiki-marker-title') : null;
var wikiMarkerAltNames =
  typeof document !== 'undefined' ? document.getElementById('wiki-marker-alt-names') : null;
var wikiMarkerSubheader =
  typeof document !== 'undefined' ? document.getElementById('wiki-marker-subheader') : null;
var wikiMarkerDescription =
  typeof document !== 'undefined' ? document.getElementById('wiki-marker-description') : null;
var infoInfobox =
  typeof document !== 'undefined' ? document.getElementById('info-infobox') : null;

var wikiEntries = {};
var wikiEntriesPromise = null;

function loadWikiEntries() {
  if (wikiEntriesPromise) {
    return wikiEntriesPromise;
  }
  wikiEntriesPromise = fetch('data/wiki-entries.json')
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Failed to load wiki entries');
      }
      return response.json();
    })
    .then(function (data) {
      wikiEntries = data || {};
      return wikiEntries;
    })
    .catch(function () {
      wikiEntries = {};
      return wikiEntries;
    });
  return wikiEntriesPromise;
}

loadWikiEntries();


var WIKI_LINK_RULES = [
  { entryId: 'gorlak', terms: ['Gorlak', 'gorlak'] },
  { entryId: 'gorlock', terms: ['Gorlock', 'gorlock'] },
  {
    entryId: 'orc',
    terms: ['Orc', 'orc', 'Orcs', 'orcs', 'Orcish', 'orcish'],
  },
  {
    entryId: 'harpies',
    terms: ['Harpies', 'harpies', 'Harpy', 'harpy'],
  },
  {
    entryId: 'goblins',
    terms: ['Goblins', 'goblins', 'Goblin', 'goblin'],
  },
  {
    entryId: 'ice-trolls',
    terms: ['Ice Trolls', 'ice trolls', 'Ice Troll', 'ice troll'],
  },
  {
    entryId: 'kobolds',
    terms: ['Kobolds', 'kobolds', 'Kobold', 'kobold'],
  },
  {
    entryId: 'mountain-dwarfs',
    terms: [
      'Mountain Dwarfs',
      'mountain dwarfs',
      'Mountain Dwarf',
      'mountain dwarf',
    ],
  },
  {
    entryId: 'dark-dwarfs',
    terms: ['Dark Dwarfs', 'dark dwarfs', 'Dark Dwarf', 'dark dwarf'],
  },
  {
    entryId: 'grey-dwarfs',
    terms: ['Grey Dwarfs', 'grey dwarfs', 'Grey Dwarf', 'grey dwarf'],
  },
  {
    entryId: 'red-curse',
    terms: ['Red Curse', 'red curse', 'Saffron Blight', 'saffron blight'],
  },
  {
    entryId: 'curse-of-stone',
    terms: [
      'Curse of Stone',
      'curse of stone',
      'Stillheart Blight',
      'stillheart blight',
    ],
  },
  {
    entryId: 'religion',
    terms: ['Religion', 'religion', 'Forgefaith', 'forgefaith'],
  },
  {
    entryId: 'hill-dwarfs',
    terms: ['Hill Dwarfs', 'hill dwarfs', 'Hill Dwarf', 'hill dwarf'],
  },
  {
    entryId: 'yeti',
    terms: ['Yeti', 'yeti', 'Yetis', 'yetis'],
  },
  {
    entryId: 'drow',
    terms: ['Drow', 'drow'],
  },
  {
    entryId: 'giant',
    terms: ['Giant', 'giant', 'Giants', 'giants'],
  },
  {
    entryId: 'gnome',
    terms: ['Gnome', 'gnome', 'Gnomes', 'gnomes'],
  },
  {
    entryId: 'ratling',
    terms: ['Ratling', 'ratling', 'Ratlings', 'ratlings'],
  },
  {
    entryId: 'troglodyte',
    terms: ['Troglodyte', 'troglodyte', 'Troglodytes', 'troglodytes'],
  },
  {
    entryId: 'ogre',
    terms: ['Ogre', 'ogre', 'Ogres', 'ogres'],
  },
];

function escapeWikiTerm(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeScaleMultiplier(value) {
  var number = Number(value);
  if (!Number.isFinite(number)) {
    return ICON_SCALE_MIN;
  }
  if (number <= 0) {
    number = ICON_SCALE_MIN;
  }
  return Math.min(ICON_SCALE_MAX, Math.max(ICON_SCALE_MIN, number));
}

function getMarkerScale(marker) {
  if (!marker) return ICON_SCALE_MIN;
  if (typeof marker._iconScaleMultiplier === 'number' && Number.isFinite(marker._iconScaleMultiplier)) {
    return normalizeScaleMultiplier(marker._iconScaleMultiplier);
  }
  if (
    marker._data &&
    typeof marker._data.iconScale === 'number' &&
    Number.isFinite(marker._data.iconScale)
  ) {
    return normalizeScaleMultiplier(marker._data.iconScale);
  }
  if (
    marker._data &&
    marker._data.style &&
    typeof marker._data.style.iconScale === 'number' &&
    Number.isFinite(marker._data.style.iconScale)
  ) {
    return normalizeScaleMultiplier(marker._data.style.iconScale);
  }
  return ICON_SCALE_MIN;
}

function getScaleFromMarkerData(data) {
  if (!data) return ICON_SCALE_MIN;
  if (typeof data.iconScale === 'number' && Number.isFinite(data.iconScale)) {
    return normalizeScaleMultiplier(data.iconScale);
  }
  if (
    data.style &&
    typeof data.style === 'object' &&
    typeof data.style.iconScale === 'number' &&
    Number.isFinite(data.style.iconScale)
  ) {
    return normalizeScaleMultiplier(data.style.iconScale);
  }
  return ICON_SCALE_MIN;
}

function createScaledIcon(options, multiplier) {
  var scaleMultiplier = normalizeScaleMultiplier(
    typeof multiplier === 'number' ? multiplier : 1
  );
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
    var scaledValue = rawValue * ICON_SCALE_FACTOR * scaleMultiplier;
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
      scaled = rawValue * ICON_SCALE_FACTOR * scaleMultiplier;
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

function isWikiInfoCollapsed() {
  if (!wikiInfoPanel) {
    return true;
  }
  return wikiInfoPanel.classList.contains('wiki-info--collapsed');
}

function isSidebarShowingMarkerInfo() {
  if (!wikiInfoPanel || !wikiMarkerContainer) {
    return false;
  }
  if (!wikiInfoPanel.classList.contains('wiki-info--showing-marker')) {
    return false;
  }
  return !isWikiInfoCollapsed();
}

function resetWikiInfoContent() {
  if (wikiInfoPanel) {
    wikiInfoPanel.classList.remove('wiki-info--showing-marker');
  }
  if (wikiMarkerContainer) {
    if (!wikiMarkerContainer.classList.contains('hidden')) {
      wikiMarkerContainer.classList.add('hidden');
    }
  }
  if (wikiInfoDefault) {
    wikiInfoDefault.classList.remove('hidden');
  }
  if (wikiMarkerTitle) {
    wikiMarkerTitle.textContent = '';
  }
  if (wikiMarkerAltNames) {
    wikiMarkerAltNames.textContent = '';
    if (!wikiMarkerAltNames.classList.contains('hidden')) {
      wikiMarkerAltNames.classList.add('hidden');
    }
  }
  if (wikiMarkerSubheader) {
    wikiMarkerSubheader.textContent = '';
    if (!wikiMarkerSubheader.classList.contains('hidden')) {
      wikiMarkerSubheader.classList.add('hidden');
    }
  }
  if (wikiMarkerDescription) {
    wikiMarkerDescription.innerHTML = '';
  }
  if (wikiMarkerInfobox) {
    renderMarkerInfobox(wikiMarkerInfobox, null);
  }
  if (infoInfobox) {
    renderMarkerInfobox(infoInfobox, null);
  }
}

function renderMarkerInfobox(container, data) {
  if (!container) {
    return false;
  }

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  container.classList.add('hidden');

  if (data === null || data === undefined) {
    return false;
  }

  var parsed = data;
  if (typeof data === 'string') {
    if (data.trim() === '') {
      return false;
    }
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      return false;
    }
  }

  if (Array.isArray(parsed)) {
    parsed = { rows: parsed };
  }

  if (!parsed || typeof parsed !== 'object') {
    return false;
  }

  var hasContent = false;

  var headerTitle =
    typeof parsed.title === 'string' && parsed.title.trim() !== ''
      ? parsed.title.trim()
      : '';
  var headerSubtitle =
    typeof parsed.subtitle === 'string' && parsed.subtitle.trim() !== ''
      ? parsed.subtitle.trim()
      : '';

  if (headerTitle || headerSubtitle) {
    var header = document.createElement('div');
    header.className = 'wiki-infobox__header';
    if (headerTitle) {
      var titleEl = document.createElement('p');
      titleEl.className = 'wiki-infobox__title';
      titleEl.textContent = headerTitle;
      header.appendChild(titleEl);
    }
    if (headerSubtitle) {
      var subtitleEl = document.createElement('p');
      subtitleEl.className = 'wiki-infobox__subtitle';
      subtitleEl.textContent = headerSubtitle;
      header.appendChild(subtitleEl);
    }
    container.appendChild(header);
    hasContent = true;
  }

  var imageData = parsed.image && typeof parsed.image === 'object' ? parsed.image : null;
  if (imageData) {
    var src = '';
    if (typeof imageData.src === 'string' && imageData.src.trim() !== '') {
      src = imageData.src.trim();
    } else if (typeof imageData.url === 'string' && imageData.url.trim() !== '') {
      src = imageData.url.trim();
    }
    if (src) {
      var figure = document.createElement('figure');
      figure.className = 'wiki-infobox__image';
      var img = document.createElement('img');
      img.src = src;
      img.alt = typeof imageData.alt === 'string' ? imageData.alt : '';
      figure.appendChild(img);
      if (typeof imageData.caption === 'string' && imageData.caption.trim() !== '') {
        var caption = document.createElement('figcaption');
        caption.textContent = imageData.caption.trim();
        figure.appendChild(caption);
      }
      container.appendChild(figure);
      hasContent = true;
    }
  }

  var rows = [];
  if (Array.isArray(parsed.rows)) {
    rows = parsed.rows;
  } else if (Array.isArray(parsed.fields)) {
    rows = parsed.fields;
  }

  if (rows.length) {
    var rowsWrapper = document.createElement('div');
    rowsWrapper.className = 'wiki-infobox__rows';
    var appendedRows = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var label = '';
      var valueText = '';
      var valueHtml = '';

      if (row && typeof row === 'object' && !Array.isArray(row)) {
        if (typeof row.label === 'string') {
          label = row.label;
        } else if (typeof row.label === 'number' || typeof row.label === 'boolean') {
          label = String(row.label);
        }
        if (typeof row.valueHtml === 'string') {
          valueHtml = row.valueHtml;
        } else if (typeof row.html === 'string') {
          valueHtml = row.html;
        }
        if (!valueHtml) {
          if (typeof row.value === 'string') {
            valueText = row.value;
          } else if (typeof row.value === 'number' || typeof row.value === 'boolean') {
            valueText = String(row.value);
          } else if (Array.isArray(row.value)) {
            valueText = row.value.join(', ');
          } else if (typeof row.text === 'string') {
            valueText = row.text;
          } else if (typeof row.text === 'number' || typeof row.text === 'boolean') {
            valueText = String(row.text);
          }
        }
      } else if (Array.isArray(row)) {
        if (typeof row[0] === 'string') {
          label = row[0];
        } else if (typeof row[0] === 'number' || typeof row[0] === 'boolean') {
          label = String(row[0]);
        }
        if (typeof row[1] === 'string') {
          valueText = row[1];
        } else if (typeof row[1] === 'number' || typeof row[1] === 'boolean') {
          valueText = String(row[1]);
        }
      } else if (typeof row === 'string') {
        valueText = row;
      } else if (typeof row === 'number' || typeof row === 'boolean') {
        valueText = String(row);
      }

      var trimmedLabel = label ? String(label).trim() : '';
      var trimmedText = valueText ? String(valueText).trim() : '';
      var trimmedHtml = valueHtml ? String(valueHtml).trim() : '';
      if (!trimmedLabel && !trimmedText && !trimmedHtml) {
        continue;
      }

      var rowEl = document.createElement('div');
      rowEl.className = 'wiki-infobox__row';

      if (trimmedLabel) {
        var labelEl = document.createElement('div');
        labelEl.className = 'wiki-infobox__label';
        labelEl.textContent = trimmedLabel;
        rowEl.appendChild(labelEl);
      }

      var valueEl = document.createElement('div');
      valueEl.className = 'wiki-infobox__value';
      if (trimmedHtml) {
        if (
          typeof DOMPurify !== 'undefined' &&
          DOMPurify &&
          typeof DOMPurify.sanitize === 'function'
        ) {
          var sanitized = DOMPurify.sanitize(trimmedHtml, {
            ALLOWED_TAGS: ['strong', 'em', 'span', 'a', 'br'],
            ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
          });
          if (sanitized && sanitized.trim() !== '') {
            valueEl.innerHTML = sanitized;
          } else {
            var fallbackTemp = document.createElement('div');
            fallbackTemp.innerHTML = trimmedHtml;
            valueEl.textContent = fallbackTemp.textContent || fallbackTemp.innerText || '';
          }
        } else {
          var temp = document.createElement('div');
          temp.innerHTML = trimmedHtml;
          valueEl.textContent = temp.textContent || temp.innerText || '';
        }
      } else {
        valueEl.textContent = trimmedText;
      }
      rowEl.appendChild(valueEl);
      rowsWrapper.appendChild(rowEl);
      appendedRows += 1;
    }
    if (appendedRows > 0) {
      container.appendChild(rowsWrapper);
      hasContent = true;
    }
  }

  if (hasContent) {
    container.classList.remove('hidden');
  }
  return hasContent;
}

function enrichWikiContent(html) {
  if (typeof html !== 'string' || html.trim() === '') {
    return html;
  }

  var result = html;

  for (var i = 0; i < WIKI_LINK_RULES.length; i++) {
    var rule = WIKI_LINK_RULES[i];
    if (!rule || !rule.entryId || !Array.isArray(rule.terms)) {
      continue;
    }
    var entryAttribute = 'data-wiki-entry="' + rule.entryId + '"';
    if (result.indexOf(entryAttribute) !== -1) {
      continue;
    }
    var escapedTerms = [];
    for (var j = 0; j < rule.terms.length; j++) {
      var term = rule.terms[j];
      if (typeof term === 'string' && term !== '') {
        escapedTerms.push(escapeWikiTerm(term));
      }
    }
    if (!escapedTerms.length) {
      continue;
    }
    var patternSource = '\\b(?:' + escapedTerms.join('|') + ')\\b';
    var pattern = new RegExp(patternSource, 'gi');
    if (!pattern.test(result)) {
      continue;
    }
    var replacementPattern = new RegExp(patternSource, 'gi');
    result = result.replace(replacementPattern, function (match) {
      return (
        '<a class="wiki-entry-link" href="#wiki-' +
        rule.entryId +
        '" data-wiki-entry="' +
        rule.entryId +
        '">' +
        match +
        '</a>'
      );
    });
  }

  return result;
}

function showMarkerInfoInSidebar(title, altNames, subheader, html, infoboxData) {
  if (!wikiInfoPanel || !wikiMarkerContainer || !wikiMarkerDescription) {
    return false;
  }

  wikiInfoPanel.classList.add('wiki-info--showing-marker');
  if (wikiInfoDefault) {
    wikiInfoDefault.classList.add('hidden');
  }
  wikiMarkerContainer.classList.remove('hidden');

  if (wikiMarkerInfobox) {
    renderMarkerInfobox(wikiMarkerInfobox, infoboxData);
  }

  if (wikiMarkerTitle) {
    wikiMarkerTitle.textContent = title || '';
  }

  if (wikiMarkerAltNames) {
    var hasAltNames = typeof altNames === 'string' ? altNames.trim() !== '' : Boolean(altNames);
    if (hasAltNames) {
      wikiMarkerAltNames.textContent = String(altNames);
      wikiMarkerAltNames.classList.remove('hidden');
    } else {
      wikiMarkerAltNames.textContent = '';
      wikiMarkerAltNames.classList.add('hidden');
    }
  }

  if (wikiMarkerSubheader) {
    var hasSubheader =
      typeof subheader === 'string' ? subheader.trim() !== '' : Boolean(subheader);
    if (hasSubheader) {
      wikiMarkerSubheader.textContent = String(subheader);
      wikiMarkerSubheader.classList.remove('hidden');
    } else {
      wikiMarkerSubheader.textContent = '';
      wikiMarkerSubheader.classList.add('hidden');
    }
  }

  wikiMarkerDescription.innerHTML = html;
  return true;
}

function refreshIconScaleUI() {
  var displayText = '—';
  var sliderValue = 100;
  var disableSlider = true;
  var infoPanel =
    typeof document !== 'undefined' ? document.getElementById('info-panel') : null;
  var infoVisible = infoPanel && !infoPanel.classList.contains('hidden');
  var sidebarVisible = isSidebarShowingMarkerInfo();
  if (
    selectedMarker &&
    selectedMarker._markerType === 'marker' &&
    (infoVisible || sidebarVisible)
  ) {
    var scale = getMarkerScale(selectedMarker);
    var percent = Math.round(scale * 100);
    displayText = percent + '%';
    sliderValue = percent;
    disableSlider = false;
  }
  if (iconSizeValueDisplay) {
    iconSizeValueDisplay.textContent = displayText;
  }
  if (iconSizeSlider) {
    iconSizeSlider.disabled = disableSlider;
    if (document.activeElement !== iconSizeSlider) {
      iconSizeSlider.value = String(sliderValue);
    }
  }
}

function showInfo(title, altNames, subheader, description, infoboxData) {
  var resolvedTitle =
    typeof title === 'string' ? title : title ? String(title) : 'Marker';
  var altNamesValue =
    typeof altNames === 'string' ? altNames : altNames ? String(altNames) : '';
  var subheaderValue =
    typeof subheader === 'string' ? subheader : subheader ? String(subheader) : '';
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
    ADD_ATTR: ['id', 'href', 'src', 'alt', 'title', 'data-wiki-entry'],
  };
  var html = rendered;
  if (typeof DOMPurify !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
    html = DOMPurify.sanitize(rendered, sanitizeConfig);
  }
  html = enrichWikiContent(html);

  if (infoInfobox) {
    renderMarkerInfobox(infoInfobox, infoboxData);
  }

  if (!isWikiInfoCollapsed()) {
    var sidebarDisplayed = showMarkerInfoInSidebar(
      resolvedTitle,
      altNamesValue,
      subheaderValue,
      html,
      infoboxData
    );
    if (sidebarDisplayed) {
      var infoPanelElement = document.getElementById('info-panel');
      if (infoPanelElement) {
        infoPanelElement.classList.add('hidden');
      }
      refreshIconScaleUI();
      return;
    }
  }

  resetWikiInfoContent();
  var panel = document.getElementById('info-panel');
  if (!panel) {
    refreshIconScaleUI();
    return;
  }

  var titleElement = document.getElementById('info-title');
  if (titleElement) {
    titleElement.textContent = resolvedTitle;
  }

  var altNamesElement = document.getElementById('info-alt-names');
  if (altNamesElement) {
    if (altNamesValue && altNamesValue.trim() !== '') {
      altNamesElement.textContent = altNamesValue;
      altNamesElement.classList.remove('hidden');
    } else {
      altNamesElement.textContent = '';
      altNamesElement.classList.add('hidden');
    }
  }

  var subheaderElement = document.getElementById('info-subheader');
  if (subheaderElement) {
    if (subheaderValue && subheaderValue.trim() !== '') {
      subheaderElement.textContent = subheaderValue;
      subheaderElement.classList.remove('hidden');
    } else {
      subheaderElement.textContent = '';
      subheaderElement.classList.add('hidden');
    }
  }

  var descriptionElement = document.getElementById('info-description');
  if (descriptionElement) {
    descriptionElement.innerHTML = html;
  }
  panel.classList.remove('hidden');
  refreshIconScaleUI();
}

function openWikiEntry(entryId) {
  if (!entryId) {
    return;
  }
  var key = String(entryId).toLowerCase();
  var entry = wikiEntries[key];
  if (!entry) {
    if (wikiEntriesPromise) {
      wikiEntriesPromise.then(function () {
        var loadedEntry = wikiEntries[key];
        if (!loadedEntry) {
          return;
        }
        var loadedDescription = loadedEntry.description;
        if (Array.isArray(loadedDescription)) {
          loadedDescription = loadedDescription.join('\n\n');
        }
        clearSelectedMarker();
        showInfo(
          loadedEntry.title,
          loadedEntry.altNames,
          loadedEntry.subheader,
          loadedDescription,
          loadedEntry.infobox
        );
      });
    }
    return;
  }
  var description = entry.description;
  if (Array.isArray(description)) {
    description = description.join('\n\n');
  }
  clearSelectedMarker();
  showInfo(entry.title, entry.altNames, entry.subheader, description, entry.infobox);
}

document.getElementById('close-info').addEventListener('click', function () {
  document.getElementById('info-panel').classList.add('hidden');
  resetWikiInfoContent();
  clearSelectedMarker();
});

map.on('click', function () {
  document.getElementById('info-panel').classList.add('hidden');
  resetWikiInfoContent();
  clearSelectedMarker();
});

document.addEventListener('click', function (event) {
  var target = event && event.target ? event.target : null;
  if (!target || typeof target.closest !== 'function') {
    return;
  }
  var link = target.closest('[data-wiki-entry]');
  if (!link) {
    return;
  }
  var entryId = link.getAttribute('data-wiki-entry');
  if (!entryId) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  openWikiEntry(entryId);
});

function createIconBaseOptions(config) {
  if (!config || !Array.isArray(config.pixelSize) || config.pixelSize.length !== 2) {
    throw new Error('pixelSize [width, height] is required to create an icon.');
  }

  var width = Number(config.pixelSize[0]);
  var height = Number(config.pixelSize[1]);

  if (!isFinite(width) || width <= 0 || !isFinite(height) || height <= 0) {
    throw new Error('pixelSize values must be finite, positive numbers.');
  }

  function ratioComponent(ratios, index, fallback) {
    if (Array.isArray(ratios) && typeof ratios[index] === 'number' && isFinite(ratios[index])) {
      return ratios[index];
    }
    return fallback;
  }

  var anchorRatioX = ratioComponent(config.anchorRatio, 0, 0.5);
  var anchorRatioY = ratioComponent(config.anchorRatio, 1, 1);
  var popupRatioX = ratioComponent(config.popupAnchorRatio, 0, 0.1);
  var popupRatioY = ratioComponent(config.popupAnchorRatio, 1, -1);
  var tooltipRatioX = ratioComponent(config.tooltipAnchorRatio, 0, 0.5);
  var tooltipRatioY = ratioComponent(config.tooltipAnchorRatio, 1, -0.5);

  var baseWidth = width / ICON_SCALE_FACTOR;
  var baseHeight = height / ICON_SCALE_FACTOR;

  return {
    iconUrl: config.iconUrl,
    iconRetinaUrl: config.iconRetinaUrl || config.iconUrl,
    iconSize: [baseWidth, baseHeight],
    iconAnchor: [baseWidth * anchorRatioX, baseHeight * anchorRatioY],
    popupAnchor: [baseWidth * popupRatioX, baseHeight * popupRatioY],
    tooltipAnchor: [baseWidth * tooltipRatioX, baseHeight * tooltipRatioY],
  };
}

var ICON_DEFINITIONS = [
  { label: 'A KARAK', key: 'a-karak', file: 'a-karak.png', pixelSize: [519, 523] },
  { label: 'ABANDON DWARFHOLD', key: 'abandon-dwarfhold', file: 'Abandon Dwarfhold.png', pixelSize: [807, 465] },
  { label: 'ALTDORF', key: 'altdorf', file: 'altdorf.png', pixelSize: [37, 33] },
  { label: 'AOPPZMNXOU7G1', key: 'aoppzmnxou7g1', file: 'aoppzmnxou7g1.png', pixelSize: [2358, 2771] },
  { label: 'BARONY OF DORSEN', key: 'barony-of-dorsen', file: 'Barony of Dorsen.webp', pixelSize: [263, 365] },
  { label: 'BARONY OF LIVONIA', key: 'barony-of-livonia', file: 'Barony of Livonia.webp', pixelSize: [263, 365] },
  { label: 'BARONY OF SAXONMOORE', key: 'barony-of-saxonmoore', file: 'Barony of Saxonmoore.webp', pixelSize: [263, 365] },
  { label: 'BAZZAR', key: 'bazzar', file: 'bazzar.png', pixelSize: [37, 34] },
  { label: 'BAZZAR LARGE', key: 'bazzar-large', file: 'bazzar-large.png', pixelSize: [47, 45] },
  { label: 'BEASTMAN SMALL', key: 'beastman-small', file: 'beastman-small.png', pixelSize: [74, 60] },
  { label: 'BEASTMAN STONE', key: 'beastman-stone', file: 'beastman-stone.png', pixelSize: [33, 47] },
  { label: 'BP 002', key: 'bp-002', file: 'bp-002.webp', pixelSize: [79, 55] },
  { label: 'BP 003', key: 'bp-003', file: 'bp-003.png', pixelSize: [46, 34] },
  { label: 'BRET 012', key: 'bret-012', file: 'bret-012.png', pixelSize: [105, 68] },
  { label: 'BRET 034', key: 'bret-034', file: 'bret-034.png', pixelSize: [68, 51] },
  { label: 'BULWARK OF OLINDARDWYK', key: 'bulwark-of-olindardwyk', file: 'Bulwark of Olindardwyk.png', pixelSize: [1024, 1024] },
  { label: 'CALIPHATE OF AL DHURA', key: 'caliphate-of-al-dhura', file: 'Caliphate of Al-Dhura.png', pixelSize: [1024, 1024] },
  { label: 'CARROW', key: 'carrow', file: 'carrow.png', pixelSize: [33, 24] },
  { label: 'CONFEDERATION OF MU\'ZAD', key: 'confederation-of-muzad', file: 'Confederation of Mu\'zad.png', pixelSize: [1024, 1024] },
  { label: 'COUNTY OF ARDENNE', key: 'county-of-ardenne', file: 'County of Ardenne.webp', pixelSize: [263, 365] },
  { label: 'COUNTY OF CARDIONA', key: 'county-of-cardiona', file: 'County of Cardiona.webp', pixelSize: [232, 322] },
  { label: 'COUNTY OF PAVONARA', key: 'county-of-pavonara', file: 'County of Pavonara.png', pixelSize: [1024, 1024] },
  { label: 'COUNTY OF SANGUINHOLT', key: 'county-of-sanguinholt', file: 'County of Sanguinholt.webp', pixelSize: [219, 350] },
  { label: 'DAELMONT', key: 'daelmont', file: 'Daelmont.png', pixelSize: [1024, 1196] },
  { label: 'DUCHY OF POMERANIA', key: 'duchy-of-pomerania', file: 'Duchy of Pomerania.png', pixelSize: [535, 599] },
  { label: 'DUKEDOM OF BELLARYN', key: 'dukedom-of-bellaryn', file: 'Dukedom of Bellaryn.png', pixelSize: [1024, 1536] },
  { label: 'DUTCHY OF WENDVALE', key: 'dutchy-of-wendvale', file: 'Dutchy of Wendvale.webp', pixelSize: [234, 320] },
  { label: 'DWARF OUTPOST', key: 'dwarf-outpost', file: 'dwarf-outpost.png', pixelSize: [895, 615] },
  { label: 'ELEVEN TOWER', key: 'eleven-tower', file: 'eleven-tower.png', pixelSize: [231, 810] },
  { label: 'EMIRATE OF MALDARI', key: 'emirate-of-maldari', file: 'Emirate of Maldari.png', pixelSize: [1024, 1024] },
  { label: 'EMPIRE OF GRAND BOHEMIA', key: 'empire-of-grand-bohemia', file: 'Empire of Grand Bohemia.webp', pixelSize: [226, 335] },
  { label: 'FIEFDOM OF RANHOLDT', key: 'fiefdom-of-ranholdt', file: 'Fiefdom of Ranholdt.png', pixelSize: [1024, 1536] },
  { label: 'FORT', key: 'fort', file: 'fort.png', pixelSize: [62, 39] },
  { label: 'FREE CITY OF LAPTLYWNN', key: 'free-city-of-laptlywnn', file: 'Free City of Laptlywnn.png', pixelSize: [1024, 1024] },
  { label: 'FREE CITY OF LAPZBURG', key: 'free-city-of-lapzburg', file: 'Free City of Lapzburg.png', pixelSize: [1024, 1024] },
  { label: 'FREE CITY OF LUMBARLICHT', key: 'free-city-of-lumbarlicht', file: 'Free City of Lumbarlicht.png', pixelSize: [1024, 1024] },
  { label: 'FREE CITY OF ULYW', key: 'free-city-of-ulyw', file: 'Free City of Ulyw.png', pixelSize: [1024, 1024] },
  { label: 'FREE PIRATE CONFEDERACY OF SARTOGIO', key: 'free-pirate-confederacy-of-sartogio', file: 'Free Pirate Confederacy of Sartogio.png', pixelSize: [1024, 1536] },
  { label: 'FREE PIRATE REPUBLIC OF SABO', key: 'free-pirate-republic-of-sabo', file: 'Free Pirate Republic of Sabo.webp', pixelSize: [1080, 1080] },
  { label: 'FREE PROVINCE OF MARROLYN', key: 'free-province-of-marrolyn', file: 'Free Province of Marrolyn.png', pixelSize: [1024, 969] },
  { label: 'GATE', key: 'gate', file: 'Gate.png', pixelSize: [25, 19] },
  { label: 'GOBLIN', key: 'goblin', file: 'Goblin.png', pixelSize: [1024, 1024] },
  { label: 'GRAND BARONY OF BRANTH', key: 'grand-barony-of-branth', file: 'Grand Barony of Branth.webp', pixelSize: [263, 365] },
  { label: 'GRAND DUCHY OF THALDARA', key: 'grand-duchy-of-thaldara', file: 'Grand Duchy of Thaldara.png', pixelSize: [1024, 1536] },
  { label: 'GRAND DUTCHY OF THE PALENSADES', key: 'grand-dutchy-of-the-palensades', file: 'Grand Dutchy of The Palensades.png', pixelSize: [1024, 1536] },
  { label: 'GRAND KINGDOM OF BELLMORE', key: 'grand-kingdom-of-bellmore', file: 'Grand Kingdom of Bellmore.webp', pixelSize: [247, 337] },
  { label: 'HERALDECEMBER DAY 1 MOLSHEIM AND GUEBWILLER V0 TATOGCCTMY8G1', key: 'heraldecember-day-1-molsheim-and-guebwiller-v0-tatogcctmy8g1', file: 'heraldecember-day-1-molsheim-and-guebwiller-v0-tatogcctmy8g1.webp', pixelSize: [1080, 1188] },
  { label: 'HIRM', key: 'hirm', file: 'hirm.png', pixelSize: [518, 629] },
  { label: 'HOUSE', key: 'house', file: 'house.png', pixelSize: [506, 432] },
  { label: 'HUNTSMARSHALSHIP OF WEXSOD', key: 'huntsmarshalship-of-wexsod', file: 'Huntsmarshalship of Wexsod.png', pixelSize: [1024, 1536] },
  { label: 'KARAK ANGAZHAR', key: 'karak-angazhar', file: 'karak-angazhar.png', pixelSize: [520, 551] },
  { label: 'KARAK AZUL', key: 'karak-azul', file: 'karak-azul.png', pixelSize: [518, 519] },
  { label: 'KARAK IZOR', key: 'karak-izor', file: 'karak-izor.png', pixelSize: [518, 518] },
  { label: 'KARAK NORNN', key: 'karak-nornn', file: 'karak-nornn.png', pixelSize: [520, 531] },
  { label: 'KARAK VARN', key: 'karak-varn', file: 'karak-varn.png', pixelSize: [519, 605] },
  { label: 'KINGDOM OF GAWTHAUD', key: 'kingdom-of-gawthaud', file: 'Kingdom of Gawthaud.webp', pixelSize: [263, 365] },
  { label: 'KINGDOM OF ALVERON', key: 'kingdom-of-alveron', file: 'Kingdom of Alveron.webp', pixelSize: [263, 365] },
  { label: 'KINGDOM OF BELMOR', key: 'kingdom-of-belmor', file: 'Kingdom of Belmor.webp', pixelSize: [232, 322] },
  { label: 'KINGDOM OF BRETTON', key: 'kingdom-of-bretton', file: 'Kingdom of Bretton.webp', pixelSize: [263, 365] },
  { label: 'KINGDOM OF CALEDON', key: 'kingdom-of-caledon', file: 'Kingdom of Caledon.png', pixelSize: [1024, 1196] },
  { label: 'KINGDOM OF LANCCHASTER', key: 'kingdom-of-lancchaster', file: 'Kingdom of Lancchaster.webp', pixelSize: [263, 365] },
  { label: 'KINGDOM OF LYSANDOR', key: 'kingdom-of-lysandor', file: 'Kingdom of Lysandor.png', pixelSize: [1024, 1536] },
  { label: 'KINGDOM OF NORHAVEN', key: 'kingdom-of-norhaven', file: 'Kingdom of Norhaven.webp', pixelSize: [215, 322] },
  { label: 'KINGDOM OF OSTYLWARD', key: 'kingdom-of-ostylward', file: 'Kingdom of Ostylward.png', pixelSize: [1024, 1024] },
  { label: 'KINGDOM OF VALMONT', key: 'kingdom-of-valmont', file: 'Kingdom of Valmont.webp', pixelSize: [263, 365] },
  { label: 'KISLEV', key: 'kislev', file: 'kislev.png', pixelSize: [734, 827] },
  { label: 'LARGE BAZZAR', key: 'large-bazzar', file: 'Large-Bazzar.png', pixelSize: [47, 45] },
  { label: 'LD 003', key: 'ld-003', file: 'ld-003.webp', pixelSize: [293, 268] },
  { label: 'LD 004', key: 'ld-004', file: 'ld-004.webp', pixelSize: [191, 166] },
  { label: 'LD 005', key: 'ld-005', file: 'ld-005.webp', pixelSize: [352, 418] },
  { label: 'LD 007', key: 'ld-007', file: 'ld-007.webp', pixelSize: [89, 84] },
  { label: 'LD 008', key: 'ld-008', file: 'ld-008.webp', pixelSize: [240, 255] },
  { label: 'LD 010', key: 'ld-010', file: 'ld-010.webp', pixelSize: [264, 319] },
  { label: 'LD 012', key: 'ld-012', file: 'ld-012.webp', pixelSize: [127, 118] },
  { label: 'LD 013', key: 'ld-013', file: 'ld-013.webp', pixelSize: [300, 334] },
  { label: 'LD 015', key: 'ld-015', file: 'ld-015.webp', pixelSize: [248, 296] },
  { label: 'LD 018', key: 'ld-018', file: 'ld-018.webp', pixelSize: [170, 97] },
  { label: 'LD 019', key: 'ld-019', file: 'ld-019.webp', pixelSize: [211, 369] },
  { label: 'LD 021', key: 'ld-021', file: 'ld-021.webp', pixelSize: [189, 123] },
  { label: 'LD 022', key: 'ld-022', file: 'ld-022.webp', pixelSize: [167, 157] },
  { label: 'LD 023', key: 'ld-023', file: 'ld-023.webp', pixelSize: [252, 312] },
  { label: 'LD 026', key: 'ld-026', file: 'ld-026.webp', pixelSize: [264, 311] },
  { label: 'LEAGUE OF CORSSAIR STATES', key: 'league-of-corssair-states', file: 'League of Corssair States.png', pixelSize: [1024, 1036] },
  { label: 'LORDSHIP OF AQUITANIA', key: 'lordship-of-aquitania', file: 'Lordship of Aquitania.png', pixelSize: [1024, 1196] },
  { label: 'LORDSHIP OF BREANORE', key: 'lordship-of-breanore', file: 'Lordship of Breanore.png', pixelSize: [1024, 1196] },
  { label: 'LORDSHIP OF CALEARAGIO', key: 'lordship-of-calearagio', file: 'Lordship of Calearagio.png', pixelSize: [1024, 1196] },
  { label: 'LORDSHIP OF ESSER', key: 'lordship-of-esser', file: 'Lordship of Esser.png', pixelSize: [1024, 1536] },
  { label: 'LORDSHIP OF SILVARRA', key: 'lordship-of-silvarra', file: 'Lordship of Silvarra.png', pixelSize: [1024, 1536] },
  { label: 'MAGEACRACY OF OSTFOLD', key: 'mageacracy-of-ostfold', file: 'Mageacracy of Ostfold.png', pixelSize: [1024, 1196] },
  { label: 'MARGRAVIATE OF AURELMARK', key: 'margraviate-of-aurelmark', file: 'Margraviate of Aurelmark.png', pixelSize: [1024, 1024] },
  { label: 'MARQUESS OF LANARIA', key: 'marquess-of-lanaria', file: 'Marquess of Lanaria.webp', pixelSize: [232, 322] },
  { label: 'OBERMARCH OF RYAZAN', key: 'obermarch-of-ryazan', file: 'Obermarch of Ryazan.png', pixelSize: [1024, 1536] },
  { label: 'OG 001', key: 'og-001', file: 'og-001.webp', pixelSize: [200, 250] },
  { label: 'OG 002', key: 'og-002', file: 'og-002.webp', pixelSize: [200, 237] },
  { label: 'OG 003', key: 'og-003', file: 'og-003.webp', pixelSize: [200, 221] },
  { label: 'OG 004', key: 'og-004', file: 'og-004.webp', pixelSize: [200, 200] },
  { label: 'OG 005', key: 'og-005', file: 'og-005.webp', pixelSize: [200, 237] },
  { label: 'OG 006', key: 'og-006', file: 'og-006.webp', pixelSize: [200, 201] },
  { label: 'OG 007', key: 'og-007', file: 'og-007.webp', pixelSize: [200, 237] },
  { label: 'OG 008', key: 'og-008', file: 'og-008.webp', pixelSize: [200, 200] },
  { label: 'OG 009', key: 'og-009', file: 'og-009.webp', pixelSize: [200, 198] },
  { label: 'ORC', key: 'orc', file: 'Orc.webp', pixelSize: [99, 89] },
  { label: 'PARMOUNT KINGDOM OF RUNTHA', key: 'parmount-kingdom-of-runtha', file: 'Parmount Kingdom of Runtha.png', pixelSize: [2048, 2048] },
  { label: 'PORTO', key: 'porto', file: 'porto.png', pixelSize: [573, 341] },
  { label: 'PRINCIPALITY OF BELIGRAD', key: 'principality-of-beligrad', file: 'Principality of Beligrad.png', pixelSize: [1024, 1536] },
  { label: 'PRINCIPALITY OF BURGUND', key: 'principality-of-burgund', file: 'Principality of Burgund.webp', pixelSize: [263, 365] },
  { label: 'PRINCIPALITY OF CAELWYN', key: 'principality-of-caelwyn', file: 'Principality of Caelwyn.png', pixelSize: [1024, 846] },
  { label: 'PRINCIPALITY OF CARIDON', key: 'principality-of-caridon', file: 'Principality of Caridon.png', pixelSize: [1024, 1196] },
  { label: 'PRINCIPALITY OF CARINTH', key: 'principality-of-carinth', file: 'Principality of Carinth.png', pixelSize: [1024, 1196] },
  { label: 'PRINCIPALITY OF DELMARIS', key: 'principality-of-delmaris', file: 'Principality of Delmaris.webp', pixelSize: [263, 365] },
  { label: 'PRINCIPALITY OF GALACIA', key: 'principality-of-galacia', file: 'Principality of Galacia.png', pixelSize: [1024, 1536] },
  { label: 'PRINCIPALITY OF KARENGAL', key: 'principality-of-karengal', file: 'Principality of Karengal.webp', pixelSize: [1080, 1292] },
  { label: 'PRINCIPALITY OF LYTHWAN', key: 'principality-of-lythwan', file: 'Principality of Lythwan.webp', pixelSize: [263, 365] },
  { label: 'PRINCIPALITY OF ORANGE', key: 'principality-of-orange', file: 'Principality of Orange.webp', pixelSize: [233, 346] },
  { label: 'PRINCIPALITY OF PARAGUS', key: 'principality-of-paragus', file: 'Principality of Paragus.png', pixelSize: [1024, 1536] },
  { label: 'PRINCIPALITY OF REDWALL', key: 'principality-of-redwall', file: 'Principality of Redwall.webp', pixelSize: [263, 365] },
  { label: 'PRINCIPALITY OF TOLODO', key: 'principality-of-tolodo', file: 'Principality of Tolodo.png', pixelSize: [1024, 1536] },
  { label: 'PRINCIPALITY OF VEYLANTH', key: 'principality-of-veylanth', file: 'Principality of Veylanth.png', pixelSize: [1024, 1536] },
  { label: 'REALM OF NURN', key: 'realm-of-nurn', file: 'Realm of Nurn.png', pixelSize: [1024, 1536] },
  { label: 'REALM OF SARYNDAL', key: 'realm-of-saryndal', file: 'Realm of Saryndal.webp', pixelSize: [1080, 1080] },
  { label: 'REALM OF THE MOOT', key: 'realm-of-the-moot', file: 'Realm of the Moot.webp', pixelSize: [613, 670] },
  { label: 'REALM OF ULYWEEN', key: 'realm-of-ulyween', file: 'Realm of Ulyween.png', pixelSize: [1024, 1024] },
  { label: 'REPUBLIC OF FLORENCE', key: 'republic-of-florence', file: 'Republic of Florence.png', pixelSize: [1024, 1024] },
  { label: 'SHROUDEDISLE', key: 'shroudedisle', file: 'shroudedisle.png', pixelSize: [488, 1151] },
  { label: 'SULTANATE OF QASHIR', key: 'sultanate-of-qashir', file: 'Sultanate of Qashir.png', pixelSize: [1024, 1536] },
  { label: 'SYLDENIA', key: 'syldenia', file: 'Syldenia.webp', pixelSize: [207, 316] },
  { label: 'TANDAR', key: 'tandar', file: 'Tandar.png', pixelSize: [2161, 2161] },
  { label: 'THE DARK LORDS DOMAIN', key: 'the-dark-lords-domain', file: 'The Dark Lords Domain.png', pixelSize: [1596, 3138] },
  { label: 'THE ECCLESIASTICY', key: 'the-ecclesiasticy', file: 'The Ecclesiasticy.webp', pixelSize: [232, 335] },
  { label: 'THE FREE STATE OF MYROBERG', key: 'the-free-state-of-myroberg', file: 'The Free State of Myroberg.png', pixelSize: [1024, 1024] },
  { label: 'THE GREAT BREY HEARD', key: 'the-great-brey-heard', file: 'The Great Brey Heard.png', pixelSize: [1081, 1064] },
  { label: 'THE MONASTIC ORDER OF THE WHEEL', key: 'the-monastic-order-of-the-wheel', file: 'The Monastic Order of the Wheel.png', pixelSize: [1024, 1536] },
  { label: 'THE REALM OF AZURREACH', key: 'the-realm-of-azurreach', file: 'The Realm of Azurreach.png', pixelSize: [1024, 1024] },
  { label: 'THE SENTINALS', key: 'the-sentinals', file: 'The Sentinals.webp', pixelSize: [226, 355] },
  { label: 'THE SHIRE OF ANVILMAR', key: 'the-shire-of-anvilmar', file: 'The Shire of Anvilmar.png', pixelSize: [1024, 1536] },
  { label: 'THE SILENT ISLE', key: 'the-silent-isle', file: 'the-silent-isle.png', pixelSize: [498, 1152] },
  { label: 'THE STATE OF RHYMERIA', key: 'the-state-of-rhymeria', file: 'The State of Rhymeria.png', pixelSize: [1024, 1536] },
  { label: 'TSARDOM OF BELOGOROD', key: 'tsardom-of-belogorod', file: 'Tsardom of Belogorod.webp', pixelSize: [211, 353] },
  { label: 'VALA AZRIL UNGOL', key: 'vala-azril-ungol', file: 'vala-azril-ungol.png', pixelSize: [517, 532] },
  { label: 'VARR', key: 'varr', file: 'varr.png', pixelSize: [520, 626] },
  { label: 'VICEROY OF TARRAGON', key: 'viceroy-of-tarragon', file: 'Viceroy of Tarragon.png', pixelSize: [1024, 1196] },
  { label: 'WOOD ELF', key: 'wood-elf', file: 'wood-elf.png', pixelSize: [875, 1607] },
  { label: 'ZUF', key: 'zuf', file: 'zuf.png', pixelSize: [519, 591] },
];

var DEFAULT_ICON_KEY = (function () {
  var fallback = 'fort';
  if (ICON_DEFINITIONS.some(function (def) { return def.key === fallback; })) {
    return fallback;
  }
  return ICON_DEFINITIONS.length ? ICON_DEFINITIONS[0].key : null;
})();

var iconMap = {};

function rebuildIconMap() {
  Object.keys(iconMap).forEach(function (key) {
    delete iconMap[key];
  });
  ICON_DEFINITIONS.forEach(function (def) {
    iconMap[def.key] = createIconBaseOptions({
      iconUrl: 'icons/' + def.file,
      pixelSize: def.pixelSize,
    });
  });
}

rebuildIconMap();

function getDefaultBaseIconOptions() {
  if (DEFAULT_ICON_KEY && iconMap[DEFAULT_ICON_KEY]) {
    return iconMap[DEFAULT_ICON_KEY];
  }
  var keys = Object.keys(iconMap);
  if (!keys.length) return null;
  var firstKey = keys[0];
  return iconMap[firstKey];
}

function getBaseIconOptionsOrDefault(key) {
  if (key && iconMap[key]) {
    return iconMap[key];
  }
  return getDefaultBaseIconOptions();
}

function getIconOrDefault(key, multiplier) {
  var baseOptions = getBaseIconOptionsOrDefault(key);
  if (!baseOptions) {
    return null;
  }
  return createScaledIcon(baseOptions, multiplier);
}

function populateIconOptions(select) {
  if (!select) return;
  select.innerHTML = '';
  ICON_DEFINITIONS.forEach(function (def) {
    var option = document.createElement('option');
    option.value = def.key;
    option.textContent = def.label;
    select.appendChild(option);
  });
  if (DEFAULT_ICON_KEY && iconMap[DEFAULT_ICON_KEY]) {
    select.value = DEFAULT_ICON_KEY;
  } else if (ICON_DEFINITIONS.length) {
    select.value = ICON_DEFINITIONS[0].key;
  }
}

function populateMarkerIconSelect() {
  populateIconOptions(document.getElementById('marker-icon'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', populateMarkerIconSelect);
} else {
  populateMarkerIconSelect();
}

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
// Text labels use the site font stack; mirror it when measuring glyph widths.
var TEXT_LABEL_FONT_FAMILY = "'IM Fell DW Pica', serif";
var textMeasurementContext = null;
var textMeasurementSpan = null;

function setMarkerSelectedState(marker, isSelected) {
  if (!marker) return;
  var action = isSelected ? 'add' : 'remove';
  if (marker._icon) {
    marker._icon.classList[action]('marker-selected');
  }
  var tooltip =
    marker._nameTooltip ||
    (typeof marker.getTooltip === 'function' ? marker.getTooltip() : null);
  if (tooltip && typeof tooltip.getElement === 'function') {
    var tooltipEl = tooltip.getElement();
    if (tooltipEl) {
      tooltipEl.classList[action]('marker-selected');
    }
  }
}

function refreshMarkerIcons() {
  allMarkers.forEach(function (marker) {
    if (!marker) {
      return;
    }
    var iconKey = marker._data && marker._data.icon;
    var scale = getMarkerScale(marker);
    var newIcon = getIconOrDefault(iconKey, scale);
    if (!newIcon) {
      return;
    }
    var wasSelected = marker === selectedMarker;
    marker.setIcon(newIcon);
    marker._baseIconOptions = JSON.parse(JSON.stringify(newIcon.options));
    marker._iconScaleMultiplier = scale;
    if (marker._data) {
      marker._data.iconScale = scale;
      if (!marker._data.style || typeof marker._data.style !== 'object') {
        marker._data.style = {};
      }
      if (scale === 1) {
        delete marker._data.style.iconScale;
        if (Object.keys(marker._data.style).length === 0) {
          delete marker._data.style;
        }
      } else {
        marker._data.style.iconScale = scale;
      }
    }
    if (wasSelected) {
      setMarkerSelectedState(marker, true);
      if (
        !marker._icon &&
        typeof window !== 'undefined' &&
        window.requestAnimationFrame
      ) {
        window.requestAnimationFrame(function () {
          setMarkerSelectedState(marker, true);
        });
      }
    }
  });
  if (typeof rescaleIcons === 'function' && map && map.getZoom) {
    rescaleIcons();
  }
  refreshIconScaleUI();
}

function applyScaleToMarker(marker, scale) {
  if (!marker) return;
  var normalized = normalizeScaleMultiplier(scale);
  var iconKey = marker._data && marker._data.icon;
  var newIcon = getIconOrDefault(iconKey, normalized);
  if (!newIcon) {
    return;
  }
  var wasSelected = marker === selectedMarker;
  marker.setIcon(newIcon);
  marker._baseIconOptions = JSON.parse(JSON.stringify(newIcon.options));
  marker._iconScaleMultiplier = normalized;
  if (marker._data) {
    marker._data.iconScale = normalized;
    if (!marker._data.style || typeof marker._data.style !== 'object') {
      marker._data.style = {};
    }
    if (normalized === 1) {
      delete marker._data.style.iconScale;
      if (Object.keys(marker._data.style).length === 0) {
        delete marker._data.style;
      }
    } else {
      marker._data.style.iconScale = normalized;
    }
  }
  if (wasSelected) {
    setMarkerSelectedState(marker, true);
    if (
      !marker._icon &&
      typeof window !== 'undefined' &&
      window.requestAnimationFrame
    ) {
      window.requestAnimationFrame(function () {
        setMarkerSelectedState(marker, true);
      });
    }
  }
  rescaleIcons();
}

function updateSelectedMarkerScale(multiplier) {
  if (!selectedMarker || selectedMarker._markerType !== 'marker') {
    refreshIconScaleUI();
    return;
  }
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
    return;
  }
  var normalized = normalizeScaleMultiplier(multiplier);
  if (Math.abs(normalized - getMarkerScale(selectedMarker)) < 0.001) {
    refreshIconScaleUI();
    return;
  }
  applyScaleToMarker(selectedMarker, normalized);
  saveMarkers();
  refreshIconScaleUI();
}

iconSizeSlider = document.getElementById('icon-size-slider');
iconSizeValueDisplay = document.getElementById('icon-size-value');
refreshIconScaleUI();

if (iconSizeSlider) {
  var handleIconSizeInput = function (event) {
    if (!selectedMarker || selectedMarker._markerType !== 'marker') {
      refreshIconScaleUI();
      return;
    }
    var sliderValue = Number(event.target.value);
    if (!Number.isFinite(sliderValue)) {
      return;
    }
    updateSelectedMarkerScale(sliderValue / 100);
  };
  iconSizeSlider.addEventListener('input', handleIconSizeInput);
  iconSizeSlider.addEventListener('change', handleIconSizeInput);
}

Settlements.addTo(map);
territoriesOverlay.addTo(map);

function clearSelectedMarker() {
  setMarkerSelectedState(selectedMarker, false);
  selectedMarker = null;
  refreshIconScaleUI();
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
    setMarkerSelectedState(marker, true);
  }
  if (marker._icon) {
    applyHighlight();
  } else if (typeof marker.once === 'function') {
    marker.once('add', applyHighlight);
  }
  selectedMarker = marker;
  refreshIconScaleUI();
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
  rescaleMarkerNameLabels();
}

function rescaleMarkerNameLabels() {
  if (!Array.isArray(allMarkers)) {
    return;
  }
  if (baseZoom === undefined) {
    baseZoom = map.getZoom();
  }
  var scale = Math.pow(2, map.getZoom() - baseZoom);
  allMarkers.forEach(function (marker) {
    if (!marker || !marker._nameTooltip) {
      return;
    }
    var tooltip = marker._nameTooltip;
    var tooltipEl = tooltip.getElement && tooltip.getElement();
    if (!tooltipEl) {
      return;
    }
    var baseFontSize = tooltipEl.dataset && tooltipEl.dataset.baseFontSize;
    if (!baseFontSize) {
      return;
    }
    var inlineTransform = tooltipEl.style.transform;
    var baseTransform = inlineTransform;
    if (!baseTransform || baseTransform === 'none') {
      var computedTransform = window.getComputedStyle(tooltipEl).transform;
      baseTransform = computedTransform && computedTransform !== 'none' ? computedTransform : '';
    }
    if (baseTransform) {
      baseTransform = baseTransform.replace(/\s*scale\([^)]+\)\s*$/, '');
    }
    if (tooltipEl.dataset) {
      tooltipEl.dataset.baseTransform = baseTransform;
    }
    var baseTransformValue = baseTransform || '';
    tooltipEl.style.fontSize = baseFontSize + 'px';
    tooltipEl.style.transform =
      (baseTransformValue ? baseTransformValue + ' ' : '') + 'scale(' + scale + ')';
    tooltipEl.style.transformOrigin = 'top left';
  });
}

function getTextLabelScale() {
  if (baseZoom === undefined) {
    baseZoom = map.getZoom();
  }
  return Math.pow(2, map.getZoom() - baseZoom);
}

function rescaleTextLabels(scaleOverride, useTransition) {
  var scale =
    typeof scaleOverride === 'number' && isFinite(scaleOverride)
      ? scaleOverride
      : getTextLabelScale();
  allTextLabels.forEach(function (m) {
    if (!m._icon) {
      return;
    }
    var inner = m._icon.querySelector('.text-label__inner');
    if (!inner) {
      return;
    }
    inner.style.transform = 'scale(' + scale + ')';
    if (useTransition === true) {
      inner.style.transition = 'transform 0.25s ease';
    } else if (useTransition === false) {
      inner.style.transition = '';
    }
    var inner = m._icon.querySelector('.text-label__inner');
    if (!inner) {
      return;
    }
    inner.style.transform = 'scale(' + scale + ')';
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

function safeJsonParse(value) {
  if (typeof value !== 'string') {
    return null;
  }
  var trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
      console.warn('Unable to parse JSON column', trimmed, err);
    }
  }
  return null;
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
      var styleRaw = safeJsonParse(cols[13]);
      var style = styleRaw && typeof styleRaw === 'object' ? styleRaw : undefined;
      var iconScaleValue =
        style && typeof style.iconScale === 'number' && Number.isFinite(style.iconScale)
          ? style.iconScale
          : undefined;
      var infoboxRaw = cols.length > 15 ? safeJsonParse(cols[15]) : null;
      var infobox = infoboxRaw && typeof infoboxRaw === 'object' ? infoboxRaw : null;
      markers.push({
        lat: parseFloat(cols[1]),
        lng: parseFloat(cols[2]),
        icon: cols[3] || DEFAULT_ICON_KEY,
        name: cols[4],
        altNames: cols[5] || '',
        subheader: cols[6] || '',
        description: cols[7],
        style: style,
        overlay: cols[14] || '',
        iconScale: iconScaleValue,
        infobox: infobox,
      });
    } else if (type === 'text') {
      var textInfoboxRaw = cols.length > 15 ? safeJsonParse(cols[15]) : null;
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
        infobox: textInfoboxRaw && typeof textInfoboxRaw === 'object' ? textInfoboxRaw : null,
      });
    } else if (type === 'polygon') {
      var coordsRaw = cols[12] ? safeJsonParse(cols[12]) : null;
      var coords = Array.isArray(coordsRaw) ? coordsRaw : [];
      var polygonStyleRaw = cols[13] ? safeJsonParse(cols[13]) : null;
      var polygonStyle =
        polygonStyleRaw && typeof polygonStyleRaw === 'object' ? polygonStyleRaw : undefined;
      polygons.push({
        name: cols[4],
        description: cols[7],
        coords: coords,
        style: polygonStyle,
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
    'type,lat,lng,icon,name/text,alt_names,subheader/text,description,size,angle,spacing,curve,coords,style,overlay,infobox'
  ];

  customMarkers.forEach(function (m) {
    var styleString = '{}';
    try {
      styleString = JSON.stringify(m.style || {});
    } catch (err) {
      styleString = '{}';
    }
    var infoboxString = '';
    if (m.infobox && typeof m.infobox === 'object') {
      try {
        infoboxString = JSON.stringify(m.infobox);
      } catch (err) {
        infoboxString = '';
      }
    }
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
        escapeCsvValue(styleString),
        escapeCsvValue(m.overlay || ''),
        escapeCsvValue(infoboxString)
      ].join(',')
    );
  });

  customTextLabels.forEach(function (t) {
    var textInfoboxString = '';
    if (t.infobox && typeof t.infobox === 'object') {
      try {
        textInfoboxString = JSON.stringify(t.infobox);
      } catch (err) {
        textInfoboxString = '';
      }
    }
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
        escapeCsvValue(t.overlay || ''),
        escapeCsvValue(textInfoboxString)
      ].join(',')
    );
  });

  customPolygons.forEach(function (p) {
    var coordsString = '[]';
    try {
      coordsString = JSON.stringify(p.coords);
    } catch (err) {
      coordsString = '[]';
    }
    var styleString = '{}';
    try {
      styleString = JSON.stringify(p.style || {});
    } catch (err) {
      styleString = '{}';
    }
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
        escapeCsvValue(coordsString),
        escapeCsvValue(styleString),
        '',
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

function detachMarker(marker) {
  if (!marker) return;
  map.removeLayer(marker);
}

function detachTextLabel(labelMarker) {
  if (!labelMarker) return;
  map.removeLayer(labelMarker);
}

function ensureMarkerNameLabelClickable(marker, tooltip) {
  if (!marker || !tooltip || typeof tooltip.getElement !== 'function') {
    return;
  }

  function attachHandler(el) {
    if (!el || el.dataset.markerClickBound === 'true') {
      return;
    }
    el.dataset.markerClickBound = 'true';
    el.addEventListener('click', function (event) {
      L.DomEvent.stopPropagation(event);
      marker.fire('click');
    });
  }

  var tooltipEl = tooltip.getElement();
  if (tooltipEl) {
    attachHandler(tooltipEl);
    return;
  }

  if (typeof tooltip.once === 'function') {
    tooltip.once('add', function () {
      attachHandler(tooltip.getElement());
    });
  }
}

function updateMarkerNameLabel(marker, name) {
  if (!marker || marker._markerType !== 'marker') {
    return;
  }
  var label = '';
  if (typeof name === 'string') {
    label = name.trim();
  } else if (name) {
    label = String(name).trim();
  }
  if (!label) {
    if (marker._nameTooltip) {
      marker.unbindTooltip();
      marker._nameTooltip = null;
    }
    return;
  }
  if (marker._nameTooltip) {
    marker._nameTooltip.setContent(label);
    ensureMarkerNameLabelClickable(marker, marker._nameTooltip);
    return;
  }
  marker.bindTooltip(label, {
    permanent: true,
    direction: 'bottom',
    className: 'marker-name-tooltip',
    opacity: 1,
    offset: [0, 0],
    interactive: true,
  });
  marker._nameTooltip = marker.getTooltip();
  if (marker._nameTooltip) {
    var tooltip = marker._nameTooltip;
    var tooltipEl = tooltip.getElement && tooltip.getElement();
    var baseFontSize = null;
    if (tooltipEl) {
      var computed = window.getComputedStyle(tooltipEl);
      var parsed = parseFloat(computed.fontSize);
      if (isFinite(parsed)) {
        baseFontSize = parsed;
      }
      if (baseFontSize !== null) {
        tooltipEl.dataset.baseFontSize = String(baseFontSize);
      }
      ensureMarkerNameLabelClickable(marker, tooltip);
    }
    if (!tooltipEl && typeof tooltip.once === 'function') {
      tooltip.once('add', function () {
        var el = tooltip.getElement && tooltip.getElement();
        if (!el) {
          return;
        }
        var computedStyle = window.getComputedStyle(el);
        var parsedSize = parseFloat(computedStyle.fontSize);
        if (!isFinite(parsedSize)) {
          return;
        }
        el.dataset.baseFontSize = String(parsedSize);
        ensureMarkerNameLabelClickable(marker, tooltip);
        rescaleMarkerNameLabels();
      });
    }
  }
}

function addMarkerToMap(data) {
  var scale = getScaleFromMarkerData(data);
  data.iconScale = scale;
  if (scale === 1) {
    if (data.style && typeof data.style === 'object') {
      delete data.style.iconScale;
      if (Object.keys(data.style).length === 0) {
        delete data.style;
      }
    }
  } else {
    if (!data.style || typeof data.style !== 'object') {
      data.style = {};
    }
    data.style.iconScale = scale;
  }
  var icon = getIconOrDefault(data.icon, scale);
  if (data.subheader === undefined || data.subheader === null) {
    data.subheader = '';
  }
  if (data.altNames === undefined || data.altNames === null) {
    data.altNames = '';
  }
  if (data.infobox && typeof data.infobox !== 'object') {
    var parsedInfobox = safeJsonParse(String(data.infobox));
    data.infobox = parsedInfobox && typeof parsedInfobox === 'object' ? parsedInfobox : null;
  }
  if (data.infobox === undefined) {
    data.infobox = null;
  }
  var customMarker = createMarker(
    data.lat,
    data.lng,
    icon,
    scale,
    data.name,
    data.altNames,
    data.subheader,
    data.description,
    data.infobox
  );
  customMarker.addTo(map);
  data.overlay = '';
  customMarker._data = data;
  customMarker._iconScaleMultiplier = scale;
  updateMarkerNameLabel(customMarker, data.name);
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
  var m = L.marker([data.lat, data.lng], {
    icon: textIcon,
    draggable: true,
    pane: 'textPane',
  });
  m
    .on('click', function (ev) {
      L.DomEvent.stopPropagation(ev);
      clearSelectedMarker();
      if (this._icon) {
        setMarkerSelectedState(this, true);
        selectedMarker = this;
        refreshIconScaleUI();
      }
      showInfo(data.text, data.altNames, data.subheader, data.description, data.infobox);
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
  m.addTo(map);
  data.overlay = '';
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
function createMarker(
  lat,
  lng,
  icon,
  iconScale,
  name,
  altNames,
  subheader,
  description,
  infobox
) {
  var scale = normalizeScaleMultiplier(iconScale);
  var m = L.marker([lat, lng], { icon: icon, draggable: true })
    .on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      clearSelectedMarker();
      if (this._icon) {
        setMarkerSelectedState(this, true);
        selectedMarker = this;
        refreshIconScaleUI();
      }
      var d =
        this._data || {
          name: name,
          altNames: altNames,
          subheader: subheader,
          description: description,
          infobox: infobox,
        };
      showInfo(d.name, d.altNames, d.subheader, d.description, d.infobox);
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
  updateMarkerNameLabel(m, name);
  m._baseIconOptions = JSON.parse(JSON.stringify(icon.options));
  m._iconScaleMultiplier = scale;
  allMarkers.push(m);
  return m;
}
// ******END OF MARKERS DECLARATION ******

map.on('zoomend', rescaleIcons);
map.on('zoomstart', function () {
  rescaleTextLabels(getTextLabelScale(), true);
});
map.on('zoomanim', function (event) {
  if (!event || typeof event.scale !== 'number' || !isFinite(event.scale)) {
    return;
  }
  var currentScale = getTextLabelScale();
  rescaleTextLabels(currentScale * event.scale, true);
});
map.on('zoomend', function () {
  rescaleTextLabels(getTextLabelScale(), false);
});

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
  var infoboxField = document.getElementById('marker-infobox');
  overlay.classList.remove('hidden');
  convertBtn.classList.add('hidden');
  document.getElementById('marker-alt-names').value = '';
  document.getElementById('marker-subheader').value = '';
  if (infoboxField) {
    infoboxField.value = '';
  }

  function submitHandler() {
    var name = document.getElementById('marker-name').value || 'Marker';
    var altNames = document.getElementById('marker-alt-names').value || '';
    var subheader = document.getElementById('marker-subheader').value || '';
    var description =
      document.getElementById('marker-description').value || '';
    var iconKey = document.getElementById('marker-icon').value || DEFAULT_ICON_KEY;
    var infoboxData = null;
    if (infoboxField) {
      var infoboxRaw = infoboxField.value ? infoboxField.value.trim() : '';
      if (infoboxRaw) {
        try {
          infoboxData = JSON.parse(infoboxRaw);
        } catch (err) {
          alert('Infobox data must be valid JSON.');
          return;
        }
      }
    }
    var data = {
      lat: latlng.lat,
      lng: latlng.lng,
      name: name,
      altNames: altNames,
      subheader: subheader,
      description: description,
      icon: iconKey,
      infobox: infoboxData,
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
    document.getElementById('marker-icon').value = DEFAULT_ICON_KEY || '';
    if (infoboxField) {
      infoboxField.value = '';
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
  var infoboxField = document.getElementById('marker-infobox');
  overlay.classList.remove('hidden');
  convertBtn.classList.remove('hidden');

  document.getElementById('marker-name').value = marker._data.name || '';
  document.getElementById('marker-alt-names').value = marker._data.altNames || '';
  document.getElementById('marker-subheader').value = marker._data.subheader || '';
  document.getElementById('marker-description').value = marker._data.description || '';
  document.getElementById('marker-icon').value = marker._data.icon || DEFAULT_ICON_KEY || '';
  if (infoboxField) {
    try {
      infoboxField.value = marker._data.infobox
        ? JSON.stringify(marker._data.infobox, null, 2)
        : '';
    } catch (err) {
      infoboxField.value = '';
    }
  }
  if (title) title.textContent = 'Edit Marker';

  function submitHandler() {
    var name = document.getElementById('marker-name').value || 'Marker';
    var altNames = document.getElementById('marker-alt-names').value || '';
    var subheader = document.getElementById('marker-subheader').value || '';
    var description = document.getElementById('marker-description').value || '';
    var iconKey = document.getElementById('marker-icon').value || DEFAULT_ICON_KEY;
    var infoboxData = marker._data.infobox || null;
    if (infoboxField) {
      var infoboxRaw = infoboxField.value ? infoboxField.value.trim() : '';
      if (infoboxRaw) {
        try {
          infoboxData = JSON.parse(infoboxRaw);
        } catch (err) {
          alert('Infobox data must be valid JSON.');
          return;
        }
      } else {
        infoboxData = null;
      }
    }
    marker._data.name = name;
    marker._data.altNames = altNames;
    marker._data.subheader = subheader;
    marker._data.description = description;
    marker._data.icon = iconKey;
    marker._data.overlay = '';
    marker._data.infobox = infoboxData;

    updateMarkerNameLabel(marker, name);
    applyScaleToMarker(marker, getMarkerScale(marker));
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
    document.getElementById('marker-icon').value = DEFAULT_ICON_KEY || '';
    if (infoboxField) {
      infoboxField.value = '';
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

(function setupMarkdownImageInsertion() {
  if (typeof document === 'undefined') {
    return;
  }

  function insertAtCursor(textarea, text) {
    if (!textarea) {
      return;
    }

    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var value = textarea.value || '';
    if (typeof start !== 'number' || typeof end !== 'number') {
      textarea.value = value + text;
      textarea.focus();
      return;
    }

    var before = value.slice(0, start);
    var after = value.slice(end);
    textarea.value = before + text + after;
    var cursor = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);

    var event;
    if (typeof Event === 'function') {
      event = new Event('input', { bubbles: true });
    } else {
      event = document.createEvent('Event');
      event.initEvent('input', true, true);
    }
    textarea.dispatchEvent(event);
  }

  function handleButtonClick(evt) {
    var button = evt.currentTarget;
    var targetId = button && button.getAttribute('data-target');
    if (!targetId) {
      return;
    }
    var selector = '.markdown-image-input[data-target="' + targetId + '"]';
    var input = document.querySelector(selector);
    if (!input) {
      return;
    }
    input.value = '';
    input.click();
  }

  function handleFileSelection(evt) {
    var input = evt.currentTarget;
    if (!input || !input.files || !input.files.length) {
      return;
    }

    var targetId = input.getAttribute('data-target');
    if (!targetId) {
      return;
    }

    var textarea = document.getElementById(targetId);
    if (!textarea) {
      return;
    }

    var file = input.files[0];
    var fileName = file && file.name ? file.name : '';
    if (!fileName) {
      return;
    }

    var safeFileName = fileName.replace(/[/\\]+/g, '');
    var encodedFileName = encodeURIComponent(safeFileName);

    var defaultAlt = safeFileName.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
    if (!defaultAlt) {
      defaultAlt = 'image';
    }

    var altText = defaultAlt;
    if (typeof window !== 'undefined' && window.prompt) {
      var response = window.prompt('Alt text for the image:', defaultAlt);
      if (response !== null) {
        altText = response.trim() || defaultAlt;
      }
    }

    altText = altText.replace(/\]/g, '\\]');
    var markdownPath = 'images/' + encodedFileName;
    var markdown = '![' + altText + '](' + markdownPath + ')';

    var needsPrefixSpace =
      textarea.value && /\S$/.test(textarea.value) && textarea.selectionStart === textarea.selectionEnd;
    var insertion = (needsPrefixSpace ? ' ' : '') + markdown + '\n';
    insertAtCursor(textarea, insertion);
  }

  var buttons = document.querySelectorAll('.markdown-image-button');
  var inputs = document.querySelectorAll('.markdown-image-input');
  if (!buttons.length || !inputs.length) {
    return;
  }

  Array.prototype.forEach.call(buttons, function (button) {
    button.addEventListener('click', handleButtonClick);
  });
  Array.prototype.forEach.call(inputs, function (input) {
    input.addEventListener('change', handleFileSelection);
  });
})();

function showTextForm(latlng) {
  var overlay = document.getElementById('text-form-overlay');
  var saveBtn = document.getElementById('text-save');
  var cancelBtn = document.getElementById('text-cancel');
  var convertBtn = document.getElementById('text-convert');
  overlay.classList.remove('hidden');
  convertBtn.classList.add('hidden');
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
  var data = labelMarker._data;

  document.getElementById('text-label-text').value = data.text || '';
  document.getElementById('text-label-alt-names').value = data.altNames || '';
  document.getElementById('text-label-subheader').value = data.subheader || '';
  document.getElementById('text-label-description').value = data.description || '';
  document.getElementById('text-label-size').value = data.size || 14;
  document.getElementById('text-label-angle').value = data.angle || 0;
  document.getElementById('text-letter-spacing').value = data.spacing || 0;
  document.getElementById('text-curve-radius').value = data.curve || 0;
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
    data.overlay = '';
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
    overlay: '',
    infobox: data.infobox || null,
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
    icon: DEFAULT_ICON_KEY || '',
    overlay: '',
    infobox: data.infobox || null,
  };
  customMarkers.push(markerData);
  var marker = addMarkerToMap(markerData);
  saveMarkers();
  editMarkerForm(marker);
}

function setupLeafletDrawFallbackControl() {
  if (typeof L === 'undefined' || !L || !L.Control) {
    return { available: false, usingFallback: false };
  }

  var hasPlugin =
    L.Draw &&
    L.Draw.Event &&
    typeof L.Control.Draw === 'function' &&
    typeof L.Draw.Event.CREATED === 'string';
  if (hasPlugin) {
    return { available: true, usingFallback: false };
  }

  var DrawEvent = {
    CREATED: 'draw:created',
    EDITED: 'draw:edited',
    DELETED: 'draw:deleted',
  };

  if (!L.Draw) {
    L.Draw = { Event: DrawEvent };
  } else {
    if (!L.Draw.Event) {
      L.Draw.Event = DrawEvent;
    } else {
      if (!L.Draw.Event.CREATED) {
        L.Draw.Event.CREATED = DrawEvent.CREATED;
      }
      if (!L.Draw.Event.EDITED) {
        L.Draw.Event.EDITED = DrawEvent.EDITED;
      }
      if (!L.Draw.Event.DELETED) {
        L.Draw.Event.DELETED = DrawEvent.DELETED;
      }
    }
  }

  var defaultShapeOptions = {
    color: '#f357a1',
    weight: 2,
    fillColor: '#f357a1',
    fillOpacity: 0.2,
  };

  function PolygonDrawingSession(map, options) {
    this._map = map;
    this._options = options || {};
    this._shapeOptions = L.Util.extend({}, defaultShapeOptions);
    if (options && options.shapeOptions) {
      this._shapeOptions = L.Util.extend(this._shapeOptions, options.shapeOptions);
    }
    this._latlngs = [];
    this._markers = [];
    this._polyline = L.polyline([], {
      color: this._shapeOptions.color,
      weight: Math.max(1, this._shapeOptions.weight || 2),
      opacity: 0.7,
      dashArray: '4,6',
    }).addTo(this._map);
    this._preview = L.polygon([], this._shapeOptions);
    this._onClick = this._onClick.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onDoubleClick = this._onDoubleClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._map.doubleClickZoom.disable();
    this._map.on('click', this._onClick);
    this._map.on('mousemove', this._onMouseMove);
    this._map.on('dblclick', this._onDoubleClick);
    document.addEventListener('keydown', this._onKeyDown);
  }

  PolygonDrawingSession.prototype._updatePreview = function (hoverLatLng) {
    var points = this._latlngs.slice();
    if (hoverLatLng) {
      points.push(hoverLatLng);
    }
    this._polyline.setLatLngs(points);
    if (this._latlngs.length >= 3) {
      if (!this._map.hasLayer(this._preview)) {
        this._preview.addTo(this._map);
      }
      this._preview.setLatLngs([points]);
    } else if (this._map.hasLayer(this._preview)) {
      this._map.removeLayer(this._preview);
    }
  };

  PolygonDrawingSession.prototype._onClick = function (e) {
    if (!e || !e.latlng) {
      return;
    }
    this._latlngs.push(e.latlng);
    var marker = L.circleMarker(e.latlng, {
      radius: 5,
      weight: 2,
      color: this._shapeOptions.color,
      fillColor: '#ffffff',
      fillOpacity: 1,
    }).addTo(this._map);
    this._markers.push(marker);
    if (e.originalEvent) {
      L.DomEvent.stop(e.originalEvent);
    }
    this._updatePreview();
  };

  PolygonDrawingSession.prototype._onMouseMove = function (e) {
    if (!this._latlngs.length || !e || !e.latlng) {
      return;
    }
    this._updatePreview(e.latlng);
  };

  PolygonDrawingSession.prototype._onDoubleClick = function (e) {
    if (e && e.originalEvent) {
      L.DomEvent.stop(e.originalEvent);
    }
    if (this._latlngs.length >= 3) {
      this._finish();
    }
  };

  PolygonDrawingSession.prototype._onKeyDown = function (e) {
    if (!e) {
      return;
    }
    var key = e.key || '';
    if (key === 'Escape') {
      e.preventDefault();
      this.cancel();
    } else if ((key === 'Enter' || key === 'Return') && this._latlngs.length >= 3) {
      e.preventDefault();
      this._finish();
    }
  };

  PolygonDrawingSession.prototype._cleanup = function () {
    this._map.off('click', this._onClick);
    this._map.off('mousemove', this._onMouseMove);
    this._map.off('dblclick', this._onDoubleClick);
    this._map.doubleClickZoom.enable();
    document.removeEventListener('keydown', this._onKeyDown);
  };

  PolygonDrawingSession.prototype._clearTempLayers = function () {
    if (this._polyline) {
      this._map.removeLayer(this._polyline);
      this._polyline = null;
    }
    if (this._preview && this._map.hasLayer(this._preview)) {
      this._map.removeLayer(this._preview);
    }
    this._preview = null;
    this._markers.forEach(
      function (marker) {
        this._map.removeLayer(marker);
      }.bind(this)
    );
    this._markers = [];
  };

  PolygonDrawingSession.prototype._finish = function () {
    var latlngs = this._latlngs.slice();
    this._cleanup();
    this._clearTempLayers();
    if (latlngs.length < 3) {
      if (this._options && typeof this._options.onCancel === 'function') {
        this._options.onCancel();
      }
      return;
    }
    var polygon = L.polygon(latlngs, this._shapeOptions).addTo(this._map);
    if (this._options && typeof this._options.onFinish === 'function') {
      this._options.onFinish(polygon);
    }
  };

  PolygonDrawingSession.prototype.cancel = function () {
    this._cleanup();
    this._clearTempLayers();
    if (this._options && typeof this._options.onCancel === 'function') {
      this._options.onCancel();
    }
  };

  var FallbackDrawControl = L.Control.extend({
    options: { position: 'topleft', draw: { polygon: true }, edit: {} },
    initialize: function (options) {
      L.Control.prototype.initialize.call(this, options);
      this.options = L.Util.extend({}, this.options);
      if (options) {
        this.options = L.Util.extend(this.options, options);
      }
      this._toolbars = { edit: { _checkDisabled: function () {} } };
      this._activeSession = null;
    },
    onAdd: function (map) {
      this._map = map;
      var container = L.DomUtil.create('div', 'leaflet-bar leaflet-draw-fallback');
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      if (this.options.draw && this.options.draw.polygon) {
        var title =
          'Draw polygon (click to add points, double-click or press Enter to finish, Esc to cancel)';
        this._polygonButton = this._createButton(
          '&#9651;',
          title,
          'leaflet-draw-button',
          container,
          this._togglePolygon,
          this
        );
      }
      return container;
    },
    onRemove: function () {
      this._cancelDrawing();
      this._map = null;
    },
    _createButton: function (html, title, className, container, fn, context) {
      var link = L.DomUtil.create('a', className + ' leaflet-draw-button', container);
      link.href = '#';
      link.innerHTML = html;
      link.setAttribute('role', 'button');
      link.setAttribute('title', title);
      link.setAttribute('aria-label', title);
      L.DomEvent.on(link, 'click', L.DomEvent.stopPropagation)
        .on(link, 'mousedown', L.DomEvent.stopPropagation)
        .on(link, 'touchstart', L.DomEvent.stopPropagation)
        .on(link, 'click', L.DomEvent.preventDefault)
        .on(link, 'click', fn, context);
      return link;
    },
    _togglePolygon: function () {
      if (this._activeSession) {
        this._cancelDrawing();
      } else {
        this._startPolygon();
      }
    },
    _startPolygon: function () {
      var shapeOptions = defaultShapeOptions;
      if (this.options && this.options.draw && this.options.draw.polygon) {
        shapeOptions = L.Util.extend(
          {},
          defaultShapeOptions,
          this.options.draw.polygon.shapeOptions || {}
        );
      }
      var self = this;
      this._activeSession = new PolygonDrawingSession(this._map, {
        shapeOptions: shapeOptions,
        onFinish: function (layer) {
          self._activeSession = null;
          if (self._polygonButton) {
            L.DomUtil.removeClass(self._polygonButton, 'leaflet-draw-button-active');
          }
          self._map.fire(L.Draw.Event.CREATED, { layerType: 'polygon', layer: layer });
        },
        onCancel: function () {
          self._activeSession = null;
          if (self._polygonButton) {
            L.DomUtil.removeClass(self._polygonButton, 'leaflet-draw-button-active');
          }
        },
      });
      if (this._polygonButton) {
        L.DomUtil.addClass(this._polygonButton, 'leaflet-draw-button-active');
      }
    },
    _cancelDrawing: function () {
      if (this._activeSession) {
        this._activeSession.cancel();
        this._activeSession = null;
      }
      if (this._polygonButton) {
        L.DomUtil.removeClass(this._polygonButton, 'leaflet-draw-button-active');
      }
    },
  });

  L.Control.Draw = FallbackDrawControl;

  return { available: true, usingFallback: true };
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

var drawControlDetails = setupLeafletDrawFallbackControl();
var drawControl = null;

if (drawControlDetails.available && typeof L.Control.Draw === 'function') {
  drawControl = new L.Control.Draw({
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

  if (L.Draw && L.Draw.Event) {
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
  }

  if (drawControlDetails.usingFallback) {
    console.warn(
      'Leaflet.draw plugin not found. Using a limited in-browser fallback for polygon drawing.'
    );
  }
} else {
  console.warn('Leaflet.draw is unavailable; polygon drawing controls have been disabled.');
}

document.getElementById('save-changes').addEventListener('click', function () {
  exportFeaturesToCSV();
});

(function initializeWikiInfoPanel() {
  var panel = document.getElementById('wiki-info');
  var toggle = document.getElementById('wiki-info-toggle');

  if (!panel || !toggle) {
    return;
  }

  toggle.addEventListener('click', function () {
    var isCollapsed = panel.classList.toggle('wiki-info--collapsed');
    var isExpanded = !isCollapsed;

    panel.setAttribute('aria-expanded', String(isExpanded));
    toggle.setAttribute('aria-expanded', String(isExpanded));
    toggle.setAttribute(
      'aria-label',
      isExpanded ? 'Collapse information panel' : 'Expand information panel'
    );
    refreshIconScaleUI();
  });
})();

(function setupImageLightbox() {
  var lightbox = document.getElementById('image-lightbox');
  var lightboxImage = document.getElementById('image-lightbox-image');
  var caption = document.getElementById('image-lightbox-caption');
  var closeButton = document.getElementById('image-lightbox-close');
  var wikiDescription = document.getElementById('wiki-marker-description');
  var infoDescription = document.getElementById('info-description');
  var body = document.body || null;

  var containers = [];
  if (wikiDescription) {
    containers.push(wikiDescription);
  }
  if (infoDescription) {
    containers.push(infoDescription);
  }

  if (
    !lightbox ||
    !lightboxImage ||
    !closeButton ||
    containers.length === 0
  ) {
    return;
  }

  var previousFocus = null;

  function updateCaption(text) {
    if (!caption) {
      return;
    }
    if (text) {
      caption.textContent = text;
      caption.classList.remove('hidden');
    } else {
      caption.textContent = '';
      caption.classList.add('hidden');
    }
  }

  function closeLightbox() {
    if (lightbox.classList.contains('hidden')) {
      return;
    }

    lightbox.classList.add('hidden');
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImage.removeAttribute('src');
    lightboxImage.setAttribute('alt', '');
    updateCaption('');
    document.removeEventListener('keydown', handleKeydown, true);
    if (body) {
      body.classList.remove('no-scroll');
    }
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try {
        previousFocus.focus();
      } catch (error) {
        /* no-op */
      }
    }
    previousFocus = null;
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      closeLightbox();
    }
  }

  function openLightbox(sourceImage) {
    if (!sourceImage) {
      return;
    }

    var source = sourceImage.currentSrc || sourceImage.src;
    if (!source) {
      return;
    }

    previousFocus = document.activeElement;
    lightboxImage.src = source;

    var altText = sourceImage.getAttribute('alt') || '';
    lightboxImage.setAttribute('alt', altText);
    updateCaption(altText);

    lightbox.classList.remove('hidden');
    lightbox.setAttribute('aria-hidden', 'false');
    if (body) {
      body.classList.add('no-scroll');
    }

    document.addEventListener('keydown', handleKeydown, true);

    window.setTimeout(function () {
      try {
        closeButton.focus({ preventScroll: true });
      } catch (error) {
        try {
          closeButton.focus();
        } catch (innerError) {
          /* no-op */
        }
      }
    }, 0);
  }

  function enhanceImages(container) {
    if (!container || typeof container.querySelectorAll !== 'function') {
      return;
    }

    var images = container.querySelectorAll('img');
    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      if (img.getAttribute('data-lightbox-ready') === 'true') {
        continue;
      }
      img.setAttribute('data-lightbox-ready', 'true');
      if (!img.hasAttribute('tabindex')) {
        img.setAttribute('tabindex', '0');
      }
      if (!img.hasAttribute('role')) {
        img.setAttribute('role', 'button');
      }
      if (!img.hasAttribute('aria-label')) {
        var labelAlt = img.getAttribute('alt');
        img.setAttribute(
          'aria-label',
          labelAlt ? 'Expand image: ' + labelAlt : 'Expand image'
        );
      }
    }
  }

  function bindContainer(container) {
    enhanceImages(container);

    container.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || target.tagName !== 'IMG') {
        return;
      }
      event.preventDefault();
      openLightbox(target);
    });

    container.addEventListener('keydown', function (event) {
      var target = event.target;
      if (!target || target.tagName !== 'IMG') {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLightbox(target);
      }
    });

    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function () {
        enhanceImages(container);
      });
      observer.observe(container, {
        childList: true,
        subtree: true,
      });
    }
  }

  for (var i = 0; i < containers.length; i++) {
    bindContainer(containers[i]);
  }

  closeButton.addEventListener('click', function () {
    closeLightbox();
  });

  lightbox.addEventListener('click', function (event) {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });
})();var wikiEntries = {};
var wikiEntriesPromise = null;

function loadWikiEntries() {
  if (wikiEntriesPromise) {
    return wikiEntriesPromise;
  }
  wikiEntriesPromise = fetch('data/wiki-entries.json')
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Failed to load wiki entries');
      }
      return response.json();
    })
    .then(function (data) {
      wikiEntries = data || {};
      return wikiEntries;
    })
    .catch(function () {
      wikiEntries = {};
      return wikiEntries;
    });
  return wikiEntriesPromise;
}

loadWikiEntries();
;

var WIKI_LINK_RULES = [
  { entryId: 'gorlak', terms: ['Gorlak', 'gorlak'] },
  { entryId: 'gorlock', terms: ['Gorlock', 'gorlock'] },
  {
    entryId: 'orc',
    terms: ['Orc', 'orc', 'Orcs', 'orcs', 'Orcish', 'orcish'],
  },
  {
    entryId: 'harpies',
    terms: ['Harpies', 'harpies', 'Harpy', 'harpy'],
  },
  {
    entryId: 'goblins',
    terms: ['Goblins', 'goblins', 'Goblin', 'goblin'],
  },
  {
    entryId: 'ice-trolls',
    terms: ['Ice Trolls', 'ice trolls', 'Ice Troll', 'ice troll'],
  },
  {
    entryId: 'kobolds',
    terms: ['Kobolds', 'kobolds', 'Kobold', 'kobold'],
  },
  {
    entryId: 'mountain-dwarfs',
    terms: [
      'Mountain Dwarfs',
      'mountain dwarfs',
      'Mountain Dwarf',
      'mountain dwarf',
    ],
  },
  {
    entryId: 'dark-dwarfs',
    terms: ['Dark Dwarfs', 'dark dwarfs', 'Dark Dwarf', 'dark dwarf'],
  },
  {
    entryId: 'grey-dwarfs',
    terms: ['Grey Dwarfs', 'grey dwarfs', 'Grey Dwarf', 'grey dwarf'],
  },
  {
    entryId: 'red-curse',
    terms: ['Red Curse', 'red curse', 'Saffron Blight', 'saffron blight'],
  },
  {
    entryId: 'curse-of-stone',
    terms: [
      'Curse of Stone',
      'curse of stone',
      'Stillheart Blight',
      'stillheart blight',
    ],
  },
  {
    entryId: 'religion',
    terms: ['Religion', 'religion', 'Forgefaith', 'forgefaith'],
  },
  {
    entryId: 'hill-dwarfs',
    terms: ['Hill Dwarfs', 'hill dwarfs', 'Hill Dwarf', 'hill dwarf'],
  },
  {
    entryId: 'yeti',
    terms: ['Yeti', 'yeti', 'Yetis', 'yetis'],
  },
  {
    entryId: 'drow',
    terms: ['Drow', 'drow'],
  },
  {
    entryId: 'giant',
    terms: ['Giant', 'giant', 'Giants', 'giants'],
  },
  {
    entryId: 'gnome',
    terms: ['Gnome', 'gnome', 'Gnomes', 'gnomes'],
  },
  {
    entryId: 'ratling',
    terms: ['Ratling', 'ratling', 'Ratlings', 'ratlings'],
  },
  {
    entryId: 'troglodyte',
    terms: ['Troglodyte', 'troglodyte', 'Troglodytes', 'troglodytes'],
  },
  {
    entryId: 'ogre',
    terms: ['Ogre', 'ogre', 'Ogres', 'ogres'],
  },
];

function escapeWikiTerm(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeScaleMultiplier(value) {
  var number = Number(value);
  if (!Number.isFinite(number)) {
    return ICON_SCALE_MIN;
  }
  if (number <= 0) {
    number = ICON_SCALE_MIN;
  }
  return Math.min(ICON_SCALE_MAX, Math.max(ICON_SCALE_MIN, number));
}

function getMarkerScale(marker) {
  if (!marker) return ICON_SCALE_MIN;
  if (typeof marker._iconScaleMultiplier === 'number' && Number.isFinite(marker._iconScaleMultiplier)) {
    return normalizeScaleMultiplier(marker._iconScaleMultiplier);
  }
  if (
    marker._data &&
    typeof marker._data.iconScale === 'number' &&
    Number.isFinite(marker._data.iconScale)
  ) {
    return normalizeScaleMultiplier(marker._data.iconScale);
  }
  if (
    marker._data &&
    marker._data.style &&
    typeof marker._data.style.iconScale === 'number' &&
    Number.isFinite(marker._data.style.iconScale)
  ) {
    return normalizeScaleMultiplier(marker._data.style.iconScale);
  }
  return ICON_SCALE_MIN;
}

function getScaleFromMarkerData(data) {
  if (!data) return ICON_SCALE_MIN;
  if (typeof data.iconScale === 'number' && Number.isFinite(data.iconScale)) {
    return normalizeScaleMultiplier(data.iconScale);
  }
  if (
    data.style &&
    typeof data.style === 'object' &&
    typeof data.style.iconScale === 'number' &&
    Number.isFinite(data.style.iconScale)
  ) {
    return normalizeScaleMultiplier(data.style.iconScale);
  }
  return ICON_SCALE_MIN;
}

function createScaledIcon(options, multiplier) {
  var scaleMultiplier = normalizeScaleMultiplier(
    typeof multiplier === 'number' ? multiplier : 1
  );
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
    var scaledValue = rawValue * ICON_SCALE_FACTOR * scaleMultiplier;
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
      scaled = rawValue * ICON_SCALE_FACTOR * scaleMultiplier;
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

function isWikiInfoCollapsed() {
  if (!wikiInfoPanel) {
    return true;
  }
  return wikiInfoPanel.classList.contains('wiki-info--collapsed');
}

function isSidebarShowingMarkerInfo() {
  if (!wikiInfoPanel || !wikiMarkerContainer) {
    return false;
  }
  if (!wikiInfoPanel.classList.contains('wiki-info--showing-marker')) {
    return false;
  }
  return !isWikiInfoCollapsed();
}

function resetWikiInfoContent() {
  if (wikiInfoPanel) {
    wikiInfoPanel.classList.remove('wiki-info--showing-marker');
  }
  if (wikiMarkerContainer) {
    if (!wikiMarkerContainer.classList.contains('hidden')) {
      wikiMarkerContainer.classList.add('hidden');
    }
  }
  if (wikiInfoDefault) {
    wikiInfoDefault.classList.remove('hidden');
  }
  if (wikiMarkerTitle) {
    wikiMarkerTitle.textContent = '';
  }
  if (wikiMarkerAltNames) {
    wikiMarkerAltNames.textContent = '';
    if (!wikiMarkerAltNames.classList.contains('hidden')) {
      wikiMarkerAltNames.classList.add('hidden');
    }
  }
  if (wikiMarkerSubheader) {
    wikiMarkerSubheader.textContent = '';
    if (!wikiMarkerSubheader.classList.contains('hidden')) {
      wikiMarkerSubheader.classList.add('hidden');
    }
  }
  if (wikiMarkerDescription) {
    wikiMarkerDescription.innerHTML = '';
  }
  if (wikiMarkerInfobox) {
    renderMarkerInfobox(wikiMarkerInfobox, null);
  }
  if (infoInfobox) {
    renderMarkerInfobox(infoInfobox, null);
  }
}

function renderMarkerInfobox(container, data) {
  if (!container) {
    return false;
  }

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  container.classList.add('hidden');

  if (data === null || data === undefined) {
    return false;
  }

  var parsed = data;
  if (typeof data === 'string') {
    if (data.trim() === '') {
      return false;
    }
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      return false;
    }
  }

  if (Array.isArray(parsed)) {
    parsed = { rows: parsed };
  }

  if (!parsed || typeof parsed !== 'object') {
    return false;
  }

  var hasContent = false;

  var headerTitle =
    typeof parsed.title === 'string' && parsed.title.trim() !== ''
      ? parsed.title.trim()
      : '';
  var headerSubtitle =
    typeof parsed.subtitle === 'string' && parsed.subtitle.trim() !== ''
      ? parsed.subtitle.trim()
      : '';

  if (headerTitle || headerSubtitle) {
    var header = document.createElement('div');
    header.className = 'wiki-infobox__header';
    if (headerTitle) {
      var titleEl = document.createElement('p');
      titleEl.className = 'wiki-infobox__title';
      titleEl.textContent = headerTitle;
      header.appendChild(titleEl);
    }
    if (headerSubtitle) {
      var subtitleEl = document.createElement('p');
      subtitleEl.className = 'wiki-infobox__subtitle';
      subtitleEl.textContent = headerSubtitle;
      header.appendChild(subtitleEl);
    }
    container.appendChild(header);
    hasContent = true;
  }

  var imageData = parsed.image && typeof parsed.image === 'object' ? parsed.image : null;
  if (imageData) {
    var src = '';
    if (typeof imageData.src === 'string' && imageData.src.trim() !== '') {
      src = imageData.src.trim();
    } else if (typeof imageData.url === 'string' && imageData.url.trim() !== '') {
      src = imageData.url.trim();
    }
    if (src) {
      var figure = document.createElement('figure');
      figure.className = 'wiki-infobox__image';
      var img = document.createElement('img');
      img.src = src;
      img.alt = typeof imageData.alt === 'string' ? imageData.alt : '';
      figure.appendChild(img);
      if (typeof imageData.caption === 'string' && imageData.caption.trim() !== '') {
        var caption = document.createElement('figcaption');
        caption.textContent = imageData.caption.trim();
        figure.appendChild(caption);
      }
      container.appendChild(figure);
      hasContent = true;
    }
  }

  var rows = [];
  if (Array.isArray(parsed.rows)) {
    rows = parsed.rows;
  } else if (Array.isArray(parsed.fields)) {
    rows = parsed.fields;
  }

  if (rows.length) {
    var rowsWrapper = document.createElement('div');
    rowsWrapper.className = 'wiki-infobox__rows';
    var appendedRows = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var label = '';
      var valueText = '';
      var valueHtml = '';

      if (row && typeof row === 'object' && !Array.isArray(row)) {
        if (typeof row.label === 'string') {
          label = row.label;
        } else if (typeof row.label === 'number' || typeof row.label === 'boolean') {
          label = String(row.label);
        }
        if (typeof row.valueHtml === 'string') {
          valueHtml = row.valueHtml;
        } else if (typeof row.html === 'string') {
          valueHtml = row.html;
        }
        if (!valueHtml) {
          if (typeof row.value === 'string') {
            valueText = row.value;
          } else if (typeof row.value === 'number' || typeof row.value === 'boolean') {
            valueText = String(row.value);
          } else if (Array.isArray(row.value)) {
            valueText = row.value.join(', ');
          } else if (typeof row.text === 'string') {
            valueText = row.text;
          } else if (typeof row.text === 'number' || typeof row.text === 'boolean') {
            valueText = String(row.text);
          }
        }
      } else if (Array.isArray(row)) {
        if (typeof row[0] === 'string') {
          label = row[0];
        } else if (typeof row[0] === 'number' || typeof row[0] === 'boolean') {
          label = String(row[0]);
        }
        if (typeof row[1] === 'string') {
          valueText = row[1];
        } else if (typeof row[1] === 'number' || typeof row[1] === 'boolean') {
          valueText = String(row[1]);
        }
      } else if (typeof row === 'string') {
        valueText = row;
      } else if (typeof row === 'number' || typeof row === 'boolean') {
        valueText = String(row);
      }

      var trimmedLabel = label ? String(label).trim() : '';
      var trimmedText = valueText ? String(valueText).trim() : '';
      var trimmedHtml = valueHtml ? String(valueHtml).trim() : '';
      if (!trimmedLabel && !trimmedText && !trimmedHtml) {
        continue;
      }

      var rowEl = document.createElement('div');
      rowEl.className = 'wiki-infobox__row';

      if (trimmedLabel) {
        var labelEl = document.createElement('div');
        labelEl.className = 'wiki-infobox__label';
        labelEl.textContent = trimmedLabel;
        rowEl.appendChild(labelEl);
      }

      var valueEl = document.createElement('div');
      valueEl.className = 'wiki-infobox__value';
      if (trimmedHtml) {
        if (
          typeof DOMPurify !== 'undefined' &&
          DOMPurify &&
          typeof DOMPurify.sanitize === 'function'
        ) {
          var sanitized = DOMPurify.sanitize(trimmedHtml, {
            ALLOWED_TAGS: ['strong', 'em', 'span', 'a', 'br'],
            ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
          });
          if (sanitized && sanitized.trim() !== '') {
            valueEl.innerHTML = sanitized;
          } else {
            var fallbackTemp = document.createElement('div');
            fallbackTemp.innerHTML = trimmedHtml;
            valueEl.textContent = fallbackTemp.textContent || fallbackTemp.innerText || '';
          }
        } else {
          var temp = document.createElement('div');
          temp.innerHTML = trimmedHtml;
          valueEl.textContent = temp.textContent || temp.innerText || '';
        }
      } else {
        valueEl.textContent = trimmedText;
      }
      rowEl.appendChild(valueEl);
      rowsWrapper.appendChild(rowEl);
      appendedRows += 1;
    }
    if (appendedRows > 0) {
      container.appendChild(rowsWrapper);
      hasContent = true;
    }
  }

  if (hasContent) {
    container.classList.remove('hidden');
  }
  return hasContent;
}

function enrichWikiContent(html) {
  if (typeof html !== 'string' || html.trim() === '') {
    return html;
  }

  var result = html;

  for (var i = 0; i < WIKI_LINK_RULES.length; i++) {
    var rule = WIKI_LINK_RULES[i];
    if (!rule || !rule.entryId || !Array.isArray(rule.terms)) {
      continue;
    }
    var entryAttribute = 'data-wiki-entry="' + rule.entryId + '"';
    if (result.indexOf(entryAttribute) !== -1) {
      continue;
    }
    var escapedTerms = [];
    for (var j = 0; j < rule.terms.length; j++) {
      var term = rule.terms[j];
      if (typeof term === 'string' && term !== '') {
        escapedTerms.push(escapeWikiTerm(term));
      }
    }
    if (!escapedTerms.length) {
      continue;
    }
    var patternSource = '\\b(?:' + escapedTerms.join('|') + ')\\b';
    var pattern = new RegExp(patternSource, 'gi');
    if (!pattern.test(result)) {
      continue;
    }
    var replacementPattern = new RegExp(patternSource, 'gi');
    result = result.replace(replacementPattern, function (match) {
      return (
        '<a class="wiki-entry-link" href="#wiki-' +
        rule.entryId +
        '" data-wiki-entry="' +
        rule.entryId +
        '">' +
        match +
        '</a>'
      );
    });
  }

  return result;
}

function showMarkerInfoInSidebar(title, altNames, subheader, html, infoboxData) {
  if (!wikiInfoPanel || !wikiMarkerContainer || !wikiMarkerDescription) {
    return false;
  }

  wikiInfoPanel.classList.add('wiki-info--showing-marker');
  if (wikiInfoDefault) {
    wikiInfoDefault.classList.add('hidden');
  }
  wikiMarkerContainer.classList.remove('hidden');

  if (wikiMarkerInfobox) {
    renderMarkerInfobox(wikiMarkerInfobox, infoboxData);
  }

  if (wikiMarkerTitle) {
    wikiMarkerTitle.textContent = title || '';
  }

  if (wikiMarkerAltNames) {
    var hasAltNames = typeof altNames === 'string' ? altNames.trim() !== '' : Boolean(altNames);
    if (hasAltNames) {
      wikiMarkerAltNames.textContent = String(altNames);
      wikiMarkerAltNames.classList.remove('hidden');
    } else {
      wikiMarkerAltNames.textContent = '';
      wikiMarkerAltNames.classList.add('hidden');
    }
  }

  if (wikiMarkerSubheader) {
    var hasSubheader =
      typeof subheader === 'string' ? subheader.trim() !== '' : Boolean(subheader);
    if (hasSubheader) {
      wikiMarkerSubheader.textContent = String(subheader);
      wikiMarkerSubheader.classList.remove('hidden');
    } else {
      wikiMarkerSubheader.textContent = '';
      wikiMarkerSubheader.classList.add('hidden');
    }
  }

  wikiMarkerDescription.innerHTML = html;
  return true;
}

function refreshIconScaleUI() {
  var displayText = '—';
  var sliderValue = 100;
  var disableSlider = true;
  var infoPanel =
    typeof document !== 'undefined' ? document.getElementById('info-panel') : null;
  var infoVisible = infoPanel && !infoPanel.classList.contains('hidden');
  var sidebarVisible = isSidebarShowingMarkerInfo();
  if (
    selectedMarker &&
    selectedMarker._markerType === 'marker' &&
    (infoVisible || sidebarVisible)
  ) {
    var scale = getMarkerScale(selectedMarker);
    var percent = Math.round(scale * 100);
    displayText = percent + '%';
    sliderValue = percent;
    disableSlider = false;
  }
  if (iconSizeValueDisplay) {
    iconSizeValueDisplay.textContent = displayText;
  }
  if (iconSizeSlider) {
    iconSizeSlider.disabled = disableSlider;
    if (document.activeElement !== iconSizeSlider) {
      iconSizeSlider.value = String(sliderValue);
    }
  }
}

function showInfo(title, altNames, subheader, description, infoboxData) {
  var resolvedTitle =
    typeof title === 'string' ? title : title ? String(title) : 'Marker';
  var altNamesValue =
    typeof altNames === 'string' ? altNames : altNames ? String(altNames) : '';
  var subheaderValue =
    typeof subheader === 'string' ? subheader : subheader ? String(subheader) : '';
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
    ADD_ATTR: ['id', 'href', 'src', 'alt', 'title', 'data-wiki-entry'],
  };
  var html = rendered;
  if (typeof DOMPurify !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
    html = DOMPurify.sanitize(rendered, sanitizeConfig);
  }
  html = enrichWikiContent(html);

  if (infoInfobox) {
    renderMarkerInfobox(infoInfobox, infoboxData);
  }

  if (!isWikiInfoCollapsed()) {
    var sidebarDisplayed = showMarkerInfoInSidebar(
      resolvedTitle,
      altNamesValue,
      subheaderValue,
      html,
      infoboxData
    );
    if (sidebarDisplayed) {
      var infoPanelElement = document.getElementById('info-panel');
      if (infoPanelElement) {
        infoPanelElement.classList.add('hidden');
      }
      refreshIconScaleUI();
      return;
    }
  }

  resetWikiInfoContent();
  var panel = document.getElementById('info-panel');
  if (!panel) {
    refreshIconScaleUI();
    return;
  }

  var titleElement = document.getElementById('info-title');
  if (titleElement) {
    titleElement.textContent = resolvedTitle;
  }

  var altNamesElement = document.getElementById('info-alt-names');
  if (altNamesElement) {
    if (altNamesValue && altNamesValue.trim() !== '') {
      altNamesElement.textContent = altNamesValue;
      altNamesElement.classList.remove('hidden');
    } else {
      altNamesElement.textContent = '';
      altNamesElement.classList.add('hidden');
    }
  }

  var subheaderElement = document.getElementById('info-subheader');
  if (subheaderElement) {
    if (subheaderValue && subheaderValue.trim() !== '') {
      subheaderElement.textContent = subheaderValue;
      subheaderElement.classList.remove('hidden');
    } else {
      subheaderElement.textContent = '';
      subheaderElement.classList.add('hidden');
    }
  }

  var descriptionElement = document.getElementById('info-description');
  if (descriptionElement) {
    descriptionElement.innerHTML = html;
  }
  panel.classList.remove('hidden');
  refreshIconScaleUI();
}

function openWikiEntry(entryId) {
  if (!entryId) {
    return;
  }
  var key = String(entryId).toLowerCase();
  var entry = wikiEntries[key];
  if (!entry) {
    if (wikiEntriesPromise) {
      wikiEntriesPromise.then(function () {
        var loadedEntry = wikiEntries[key];
        if (!loadedEntry) {
          return;
        }
        var loadedDescription = loadedEntry.description;
        if (Array.isArray(loadedDescription)) {
          loadedDescription = loadedDescription.join('\n\n');
        }
        clearSelectedMarker();
        showInfo(
          loadedEntry.title,
          loadedEntry.altNames,
          loadedEntry.subheader,
          loadedDescription,
          loadedEntry.infobox
        );
      });
    }
    return;
  }
  var description = entry.description;
  if (Array.isArray(description)) {
    description = description.join('\n\n');
  }
  clearSelectedMarker();
  showInfo(entry.title, entry.altNames, entry.subheader, description, entry.infobox);
}

document.getElementById('close-info').addEventListener('click', function () {
  document.getElementById('info-panel').classList.add('hidden');
  resetWikiInfoContent();
  clearSelectedMarker();
});

map.on('click', function () {
  document.getElementById('info-panel').classList.add('hidden');
  resetWikiInfoContent();
  clearSelectedMarker();
});

document.addEventListener('click', function (event) {
  var target = event && event.target ? event.target : null;
  if (!target || typeof target.closest !== 'function') {
    return;
  }
  var link = target.closest('[data-wiki-entry]');
  if (!link) {
    return;
  }
  var entryId = link.getAttribute('data-wiki-entry');
  if (!entryId) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  openWikiEntry(entryId);
});
