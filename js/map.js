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
var ICON_SCALE_MIN = 0.01;
var ICON_SCALE_MAX = 2;
var iconSizeSlider = null;
var iconSizeValueDisplay = null;

function normalizeScaleMultiplier(value) {
  var number = Number(value);
  if (!Number.isFinite(number)) {
    return 1;
  }
  if (number <= 0) {
    number = ICON_SCALE_MIN;
  }
  return Math.min(ICON_SCALE_MAX, Math.max(ICON_SCALE_MIN, number));
}

function getMarkerScale(marker) {
  if (!marker) return 1;
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
  return 1;
}

function getScaleFromMarkerData(data) {
  if (!data) return 1;
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
  return 1;
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

function refreshIconScaleUI() {
  var displayText = '—';
  var sliderValue = 100;
  var disableSlider = true;
  var infoPanel =
    typeof document !== 'undefined' ? document.getElementById('info-panel') : null;
  var infoVisible = infoPanel && !infoPanel.classList.contains('hidden');
  if (selectedMarker && selectedMarker._markerType === 'marker' && infoVisible) {
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
  refreshIconScaleUI();
}

document.getElementById('close-info').addEventListener('click', function () {
  document.getElementById('info-panel').classList.add('hidden');
  clearSelectedMarker();
});

map.on('click', function () {
  document.getElementById('info-panel').classList.add('hidden');
  clearSelectedMarker();
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
  { label: 'BEASTMAN SMALL', key: 'beastman-small', file: 'beastman-small.png', pixelSize: [74, 60] },
  { label: 'BLOOD MOUNTAIN', key: 'blood-mountain', file: 'blood-mountain.png', pixelSize: [167, 64] },
  { label: 'BP 001', key: 'bp-001', file: 'bp-001.webp', pixelSize: [79, 59] },
  { label: 'BP 002', key: 'bp-002', file: 'bp-002.webp', pixelSize: [79, 55] },
  { label: 'BP 003', key: 'bp-003', file: 'bp-003.webp', pixelSize: [124, 77] },
  { label: 'BP 004', key: 'bp-004', file: 'bp-004.webp', pixelSize: [170, 73] },
  { label: 'BP 005', key: 'bp-005', file: 'bp-005.webp', pixelSize: [112, 120] },
  { label: 'BP 006', key: 'bp-006', file: 'bp-006.webp', pixelSize: [232, 335] },
  { label: 'BP 007', key: 'bp-007', file: 'bp-007.webp', pixelSize: [226, 355] },
  { label: 'BP 008', key: 'bp-008', file: 'bp-008.webp', pixelSize: [233, 346] },
  { label: 'BP 009', key: 'bp-009', file: 'bp-009.webp', pixelSize: [232, 322] },
  { label: 'BP 010', key: 'bp-010', file: 'bp-010.webp', pixelSize: [232, 322] },
  { label: 'BP 011', key: 'bp-011', file: 'bp-011.webp', pixelSize: [211, 353] },
  { label: 'BP 012', key: 'bp-012', file: 'bp-012.webp', pixelSize: [215, 322] },
  { label: 'BP 013', key: 'bp-013', file: 'bp-013.webp', pixelSize: [226, 335] },
  { label: 'BP 014', key: 'bp-014', file: 'bp-014.webp', pixelSize: [247, 337] },
  { label: 'BP 015', key: 'bp-015', file: 'bp-015.webp', pixelSize: [207, 316] },
  { label: 'BP 016', key: 'bp-016', file: 'bp-016.webp', pixelSize: [232, 322] },
  { label: 'BP 017', key: 'bp-017', file: 'bp-017.webp', pixelSize: [163, 272] },
  { label: 'BP 018', key: 'bp-018', file: 'bp-018.webp', pixelSize: [199, 218] },
  { label: 'BP 019', key: 'bp-019', file: 'bp-019.webp', pixelSize: [117, 99] },
  { label: 'BP 020', key: 'bp-020', file: 'bp-020.webp', pixelSize: [174, 65] },
  { label: 'BP 021', key: 'bp-021', file: 'bp-021.webp', pixelSize: [164, 65] },
  { label: 'BP 022', key: 'bp-022', file: 'bp-022.webp', pixelSize: [234, 320] },
  { label: 'BP 023', key: 'bp-023', file: 'bp-023.webp', pixelSize: [219, 350] },
  { label: 'BP 024', key: 'bp-024', file: 'bp-024.webp', pixelSize: [203, 79] },
  { label: 'BRET 001', key: 'bret-001', file: 'bret-001.webp', pixelSize: [263, 365] },
  { label: 'BRET 002', key: 'bret-002', file: 'bret-002.webp', pixelSize: [273, 114] },
  { label: 'BRET 003', key: 'bret-003', file: 'bret-003.webp', pixelSize: [263, 365] },
  { label: 'BRET 004', key: 'bret-004', file: 'bret-004.webp', pixelSize: [264, 109] },
  { label: 'BRET 005', key: 'bret-005', file: 'bret-005.webp', pixelSize: [263, 365] },
  { label: 'BRET 006', key: 'bret-006', file: 'bret-006.webp', pixelSize: [147, 103] },
  { label: 'BRET 007', key: 'bret-007', file: 'bret-007.webp', pixelSize: [263, 365] },
  { label: 'BRET 008', key: 'bret-008', file: 'bret-008.webp', pixelSize: [106, 103] },
  { label: 'BRET 009', key: 'bret-009', file: 'bret-009.webp', pixelSize: [263, 365] },
  { label: 'BRET 010', key: 'bret-010', file: 'bret-010.webp', pixelSize: [120, 96] },
  { label: 'BRET 011', key: 'bret-011', file: 'bret-011.webp', pixelSize: [263, 365] },
  { label: 'BRET 012', key: 'bret-012', file: 'bret-012.webp', pixelSize: [105, 94] },
  { label: 'BRET 013', key: 'bret-013', file: 'bret-013.webp', pixelSize: [241, 101] },
  { label: 'BRET 014', key: 'bret-014', file: 'bret-014.webp', pixelSize: [263, 365] },
  { label: 'BRET 015', key: 'bret-015', file: 'bret-015.webp', pixelSize: [263, 365] },
  { label: 'BRET 016', key: 'bret-016', file: 'bret-016.webp', pixelSize: [175, 91] },
  { label: 'BRET 017', key: 'bret-017', file: 'bret-017.webp', pixelSize: [263, 365] },
  { label: 'BRET 018', key: 'bret-018', file: 'bret-018.webp', pixelSize: [199, 97] },
  { label: 'BRET 019', key: 'bret-019', file: 'bret-019.webp', pixelSize: [263, 365] },
  { label: 'BRET 020', key: 'bret-020', file: 'bret-020.webp', pixelSize: [231, 62] },
  { label: 'BRET 021', key: 'bret-021', file: 'bret-021.webp', pixelSize: [263, 365] },
  { label: 'BRET 022', key: 'bret-022', file: 'bret-022.webp', pixelSize: [108, 104] },
  { label: 'BRET 023', key: 'bret-023', file: 'bret-023.webp', pixelSize: [263, 365] },
  { label: 'BRET 024', key: 'bret-024', file: 'bret-024.webp', pixelSize: [208, 89] },
  { label: 'BRET 025', key: 'bret-025', file: 'bret-025.webp', pixelSize: [263, 365] },
  { label: 'BRET 026', key: 'bret-026', file: 'bret-026.webp', pixelSize: [94, 103] },
  { label: 'BRET 027', key: 'bret-027', file: 'bret-027.webp', pixelSize: [263, 365] },
  { label: 'BRET 028', key: 'bret-028', file: 'bret-028.webp', pixelSize: [110, 95] },
  { label: 'BRET 029', key: 'bret-029', file: 'bret-029.webp', pixelSize: [137, 84] },
  { label: 'BRET 030', key: 'bret-030', file: 'bret-030.webp', pixelSize: [165, 76] },
  { label: 'BRET 031', key: 'bret-031', file: 'bret-031.webp', pixelSize: [240, 81] },
  { label: 'BRET 032', key: 'bret-032', file: 'bret-032.webp', pixelSize: [259, 80] },
  { label: 'BRET 033', key: 'bret-033', file: 'bret-033.webp', pixelSize: [221, 99] },
  { label: 'BRET 034', key: 'bret-034', file: 'bret-034.webp', pixelSize: [135, 83] },
  { label: 'BROKEN DWARVEN HOLD', key: 'broken-dwarven-hold', file: 'broken-dwarven-hold.png', pixelSize: [807, 465] },
  { label: 'DWARF OUTPOST', key: 'dwarf-outpost', file: 'dwarf-outpost.png', pixelSize: [895, 615] },
  { label: 'ELEVEN TOWER', key: 'eleven-tower', file: 'eleven-tower.png', pixelSize: [231, 810] },
  { label: 'EMP 001', key: 'emp-001', file: 'emp-001.webp', pixelSize: [200, 228] },
  { label: 'EMP 002', key: 'emp-002', file: 'emp-002.webp', pixelSize: [200, 284] },
  { label: 'EMP 003', key: 'emp-003', file: 'emp-003.webp', pixelSize: [200, 252] },
  { label: 'EMP 004', key: 'emp-004', file: 'emp-004.webp', pixelSize: [200, 228] },
  { label: 'FORT', key: 'fort', file: 'fort.png', pixelSize: [62, 39] },
  { label: 'HOUSE', key: 'house', file: 'house.png', pixelSize: [506, 432] },
  { label: 'KISLEV', key: 'kislev', file: 'kislev.png', pixelSize: [734, 827] },
  { label: 'LD 001', key: 'ld-001', file: 'ld-001.webp', pixelSize: [402, 285] },
  { label: 'LD 002', key: 'ld-002', file: 'ld-002.webp', pixelSize: [172, 112] },
  { label: 'LD 003', key: 'ld-003', file: 'ld-003.webp', pixelSize: [293, 268] },
  { label: 'LD 004', key: 'ld-004', file: 'ld-004.webp', pixelSize: [191, 166] },
  { label: 'LD 005', key: 'ld-005', file: 'ld-005.webp', pixelSize: [352, 418] },
  { label: 'LD 006 01', key: 'ld-006-01', file: 'ld-006-01.webp', pixelSize: [75, 141] },
  { label: 'LD 006 02', key: 'ld-006-02', file: 'ld-006-02.webp', pixelSize: [117, 110] },
  { label: 'LD 007', key: 'ld-007', file: 'ld-007.webp', pixelSize: [89, 84] },
  { label: 'LD 008', key: 'ld-008', file: 'ld-008.webp', pixelSize: [240, 255] },
  { label: 'LD 009', key: 'ld-009', file: 'ld-009.webp', pixelSize: [164, 120] },
  { label: 'LD 010', key: 'ld-010', file: 'ld-010.webp', pixelSize: [264, 319] },
  { label: 'LD 011', key: 'ld-011', file: 'ld-011.webp', pixelSize: [214, 113] },
  { label: 'LD 012', key: 'ld-012', file: 'ld-012.webp', pixelSize: [127, 118] },
  { label: 'LD 013', key: 'ld-013', file: 'ld-013.webp', pixelSize: [300, 334] },
  { label: 'LD 014', key: 'ld-014', file: 'ld-014.webp', pixelSize: [186, 120] },
  { label: 'LD 015', key: 'ld-015', file: 'ld-015.webp', pixelSize: [248, 296] },
  { label: 'LD 016', key: 'ld-016', file: 'ld-016.webp', pixelSize: [347, 115] },
  { label: 'LD 017', key: 'ld-017', file: 'ld-017.webp', pixelSize: [120, 62] },
  { label: 'LD 018', key: 'ld-018', file: 'ld-018.webp', pixelSize: [170, 97] },
  { label: 'LD 019', key: 'ld-019', file: 'ld-019.webp', pixelSize: [211, 369] },
  { label: 'LD 020 01', key: 'ld-020-01', file: 'ld-020-01.webp', pixelSize: [157, 53] },
  { label: 'LD 020 02', key: 'ld-020-02', file: 'ld-020-02.webp', pixelSize: [63, 150] },
  { label: 'LD 020 03', key: 'ld-020-03', file: 'ld-020-03.webp', pixelSize: [138, 84] },
  { label: 'LD 020 04', key: 'ld-020-04', file: 'ld-020-04.webp', pixelSize: [159, 40] },
  { label: 'LD 020 05', key: 'ld-020-05', file: 'ld-020-05.webp', pixelSize: [160, 57] },
  { label: 'LD 021', key: 'ld-021', file: 'ld-021.webp', pixelSize: [189, 123] },
  { label: 'LD 022', key: 'ld-022', file: 'ld-022.webp', pixelSize: [167, 157] },
  { label: 'LD 023', key: 'ld-023', file: 'ld-023.webp', pixelSize: [252, 312] },
  { label: 'LD 024', key: 'ld-024', file: 'ld-024.webp', pixelSize: [203, 116] },
  { label: 'LD 025', key: 'ld-025', file: 'ld-025.webp', pixelSize: [186, 126] },
  { label: 'LD 026', key: 'ld-026', file: 'ld-026.webp', pixelSize: [264, 311] },
  { label: 'LD 027', key: 'ld-027', file: 'ld-027.webp', pixelSize: [224, 114] },
  { label: 'LD 028', key: 'ld-028', file: 'ld-028.webp', pixelSize: [148, 113] },
  { label: 'LD 029', key: 'ld-029', file: 'ld-029.webp', pixelSize: [330, 75] },
  { label: 'LD 030', key: 'ld-030', file: 'ld-030.webp', pixelSize: [202, 39] },
  { label: 'LD 031 01', key: 'ld-031-01', file: 'ld-031-01.webp', pixelSize: [143, 51] },
  { label: 'LD 031 02', key: 'ld-031-02', file: 'ld-031-02.webp', pixelSize: [138, 88] },
  { label: 'LD 032', key: 'ld-032', file: 'ld-032.webp', pixelSize: [285, 52] },
  { label: 'OG 001', key: 'og-001', file: 'og-001.webp', pixelSize: [200, 250] },
  { label: 'OG 002', key: 'og-002', file: 'og-002.webp', pixelSize: [200, 237] },
  { label: 'OG 003', key: 'og-003', file: 'og-003.webp', pixelSize: [200, 221] },
  { label: 'OG 004', key: 'og-004', file: 'og-004.webp', pixelSize: [200, 200] },
  { label: 'OG 005', key: 'og-005', file: 'og-005.webp', pixelSize: [200, 237] },
  { label: 'OG 006', key: 'og-006', file: 'og-006.webp', pixelSize: [200, 201] },
  { label: 'OG 007', key: 'og-007', file: 'og-007.webp', pixelSize: [200, 237] },
  { label: 'OG 008', key: 'og-008', file: 'og-008.webp', pixelSize: [200, 200] },
  { label: 'OG 009', key: 'og-009', file: 'og-009.webp', pixelSize: [200, 198] },
  { label: 'OG 010', key: 'og-010', file: 'og-010.webp', pixelSize: [275, 256] },
  { label: 'OG 011', key: 'og-011', file: 'og-011.webp', pixelSize: [116, 76] },
  { label: 'OG 012', key: 'og-012', file: 'og-012.webp', pixelSize: [247, 138] },
  { label: 'OG 013', key: 'og-013', file: 'og-013.webp', pixelSize: [86, 73] },
  { label: 'OG 014', key: 'og-014', file: 'og-014.webp', pixelSize: [131, 284] },
  { label: 'OG 015', key: 'og-015', file: 'og-015.webp', pixelSize: [85, 76] },
  { label: 'OG 016', key: 'og-016', file: 'og-016.webp', pixelSize: [99, 89] },
  { label: 'OG 017', key: 'og-017', file: 'og-017.webp', pixelSize: [87, 78] },
  { label: 'OG 018', key: 'og-018', file: 'og-018.webp', pixelSize: [231, 83] },
  { label: 'OG 019', key: 'og-019', file: 'og-019.webp', pixelSize: [74, 51] },
  { label: 'OG 020', key: 'og-020', file: 'og-020.webp', pixelSize: [84, 76] },
  { label: 'PORTO', key: 'porto', file: 'porto.png', pixelSize: [573, 341] },
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
      if (marker._icon) {
        marker._icon.classList.add('marker-selected');
      } else if (
        typeof window !== 'undefined' &&
        window.requestAnimationFrame
      ) {
        window.requestAnimationFrame(function () {
          if (marker._icon) {
            marker._icon.classList.add('marker-selected');
          }
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
    if (marker._icon) {
      marker._icon.classList.add('marker-selected');
    } else if (
      typeof window !== 'undefined' &&
      window.requestAnimationFrame
    ) {
      window.requestAnimationFrame(function () {
        if (marker._icon) {
          marker._icon.classList.add('marker-selected');
        }
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
      var style = cols[13] ? JSON.parse(cols[13]) : undefined;
      var iconScaleValue =
        style && typeof style.iconScale === 'number' && Number.isFinite(style.iconScale)
          ? style.iconScale
          : undefined;
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
  var customMarker = createMarker(
    data.lat,
    data.lng,
    icon,
    scale,
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
  customMarker._iconScaleMultiplier = scale;
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
        refreshIconScaleUI();
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
function createMarker(lat, lng, icon, iconScale, name, altNames, subheader, description) {
  var scale = normalizeScaleMultiplier(iconScale);
  var m = L.marker([lat, lng], { icon: icon, draggable: true })
    .on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      clearSelectedMarker();
      if (this._icon) {
        this._icon.classList.add('marker-selected');
        selectedMarker = this;
        refreshIconScaleUI();
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
  m._iconScaleMultiplier = scale;
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
    var iconKey = document.getElementById('marker-icon').value || DEFAULT_ICON_KEY;
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
    document.getElementById('marker-icon').value = DEFAULT_ICON_KEY || '';
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
  document.getElementById('marker-icon').value = marker._data.icon || DEFAULT_ICON_KEY || '';
  if (overlaySelect) {
    overlaySelect.value = marker._data.overlay || '';
  }
  if (title) title.textContent = 'Edit Marker';

  function submitHandler() {
    var name = document.getElementById('marker-name').value || 'Marker';
    var altNames = document.getElementById('marker-alt-names').value || '';
    var subheader = document.getElementById('marker-subheader').value || '';
    var description = document.getElementById('marker-description').value || '';
    var iconKey = document.getElementById('marker-icon').value || DEFAULT_ICON_KEY;
    var overlayValue = overlaySelect ? overlaySelect.value : '';

    marker._data.name = name;
    marker._data.altNames = altNames;
    marker._data.subheader = subheader;
    marker._data.description = description;
    marker._data.icon = iconKey;

    applyScaleToMarker(marker, getMarkerScale(marker));
    moveMarkerToOverlay(marker, overlayValue);
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
    icon: DEFAULT_ICON_KEY || '',
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



