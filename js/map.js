//Creating the Map
var map = L.map('map', {
  zoomAnimation: true,
  markerZoomAnimation: true,
  attributionControl: false,
  minZoom: 3,
  maxZoom: 6,
  maxBoundsViscosity: 1.0,
}).setView([0, 0], 4);

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

var wikiEntries = {
  gorlak: {
    title: 'Gorlak',
    altNames: 'Bog-watcher of the Estuary Reaches',
    subheader: 'Mythic sentry said to emerge from tidal peat bogs',
    description: [
      '![The Bored Gorlak](images/the-bored-gorlak-v0-hn8cg9kvykde1.webp)',
      '## Overview',
      'Accounts compiled from eighteenth-century tidewater settlements describe the Gorlak as a solitary amphibious spirit that keeps balance between salt marsh and inland cedar stands. Its name appears in Abenaki-language notebooks as **Kwolak**, a term glossed as "stoic watcher of the mudflats."',
      '## Physical Characteristics',
      'Field notes from the 1923 "Survey of Littoral Folklore" portray the Gorlak as short and broad with river-stone scales and flexible horns that flatten when the creature submerges. Fisher families in Machigonne villages insisted the horns were not weapons but directional feelers attuned to shifting currents.',
      '## Cultural Role',
      'Oral historians from the Penobscot Nation recall elders leaving cedar smoke offerings for the Gorlak before winter eel harvests. They emphasized that the spirit dozes through most seasons, rousing only when outsiders dredge too deeply or when a singer forgets the welcoming verses at the estuary.',
      '## Primary Sources',
      '1. A gorlak; field sketch and commentary in *The Littoral Spirit Bestiary*, compiled by C. J. Banfield (Boston Ethnological Society, 1923).',
      '2. Notes recorded by Sarah Wabanaki in her 1871 travel diary, held in the Passamaquoddy Tribal Archives, describing a "gorlak who napped beside the cedar stakes until the tide scolded it awake."'
    ].join('\n\n'),
    infobox: {
      title: 'Gorlak Watch',
      subtitle: 'Estuary Guardian Profile',
      image: {
        src: 'images/the-bored-gorlak-v0-hn8cg9kvykde1.webp',
        alt: 'Illustration of the marsh sentinel Gorlak',
      },
      rows: [
        { label: 'Habitat', value: 'Peat bogs at the river estuary' },
        { label: 'Role', value: 'Balances salt and freshwater tides' },
        { label: 'Offerings', value: 'Cedar smoke braids before eel harvests' },
      ],
    },
  },
  gorlock: {
    title: 'Gorlock',
    altNames: 'The Marsh Guardian',
    subheader: 'Legendary sentinel of the tidal flats',
    description: [
      '## Overview',
      'Stories shared across the coastal villages describe the Gorlock as a shape-shifting guardian who patrols the marshlands at dusk. Travelers who respect the waterways are said to receive safe passage, while those who disturb the reeds find their camp mysteriously relocated by morning.',
      '## Role in Oral Traditions',
      'Narratives collected by river pilots emphasize that the Gorlock listens for songs offered by canoeists when they enter tidal territory. Elders recount how young navigators would practice verses to ensure the guardian recognized them as kin.',
      '## Research Notes',
      'References to a watchful marsh spirit appear in seventeenth-century journals kept by traders moving between the bay and interior. Although filtered through colonial bias, these documents corroborate the coastal teachings that the Gorlock marked key transition points between salt and fresh water.'
    ].join('\n\n')
  },
  orc: {
    title: 'Orcish Strongholds',
    altNames: 'Black Pines Confederacy blood-keeps',
    subheader: 'Border Marches martial societies and seasonal keeps',
    description: [
      '![Terraced orcish stronghold lit by volcanic embers](images/markus-neidel-woa-poi-illustration-orc-stronghold-1920.jpg)',
      '## Overview',
      'Orcish polities of the Border Marches descend from thunder-crow migrations and balance martial readiness with a ritual calendar that governs hunting, ironworking, and diplomacy. Blood-keeps pledge stone-singers, stewards, and warriors to a rotating high warband, while relay shrines offer safe passage to travelers who present water at their altars.',
      '## Clan Societies',
      'Confederacy envoys describe consensus councils held beneath the Black Pines where drum-bearing delegates can postpone war plans for a lunar cycle. Three principal circles anchor these gatherings:\n\n- **Storm Banner Circle** — frontier guardians who field ashlance cavalry and maintain avalanche beacons.\n- **Ember Hearth Circle** — metallurgists and surgeons who trade surgical knotwork for dyes and glassware.\n- **Verdant Tide Circle** — riverine logisticians who manage barge libraries and seed exchanges.',
      '## Stronghold Architecture',
      'Surveyors note concentric terraces carved from basalt with communal forges on lower rings and dream interpreter quarters atop. Alternating crenellations and horn totems hide thunderstones tuned to clan rhythms, creating humming ramparts during storms. Captain Yara Estwin credits stone-singer resonance for the keeps\' resistance to artillery.',
      '## Material and Ritual Culture',
      'Every warrior maintains a practical field blade and a ceremonial twin etched with storms they have outrun; a blade is retired only when the lineage raises a new stone-singer. Seasonal rites pair martial drills with hospitality, serving fermented pine sap to allies before the polyphonic **Song of Ashes** recounts founding migrations.',
      '## Alliances and Treaties',
      'Confederate councils weave a braided **cord of witness** that records accords renewed each year. Key strands include the **Stonewake Compact (1742)** with Karthi River monasteries, the **Second Ember Exchange (1821)** trading copper for aurora dyes, and the **Stormgate Concord (1968)** pledging mutual defense against airship fleets. Severing a strand demands the offender broker three new treaties or accept exile.',
      '## Field Notes',
      '1. Captain Yara Estwin, "Observations from the Stormcrag Frontier" — engineering notebook folios 14–29 describing thunderstone maintenance.\n2. Emissary Hallan of the Verdant Tide — recorded interview archived at the Black Pines lodge covering barge libraries and oath circles.\n3. Caravan Master Edeya Lor, *Ledger of the Sapphire Route*, entries 223–264 on trade etiquette at dawn markets.\n4. Wax cylinder of the Storm Banner Circle chant captured by Professor I. Farsen (1903), corroborating the layers of the Song of Ashes.'
    ].join('\n\n')
  },
  harpies: {
    title: 'Harpies of the Screaming Fells',
    altNames: 'Sky aeries of the White Gale campaigns',
    subheader: 'Song-clan networks guarding the thunder-drenched ridges',
    description: [
      '![Harpy circling storm-wracked cliffs](images/62249418_454104258708570_3334301194563471651_n.jpg)',
      '## Overview',
      'Screaming Fells aeries cling to basalt ridges above the cloud sea, suspended by braided stormvine anchors that hum as both heralds and seismic alarms. Harpy migrations follow lightning-fed thermals between the Westspire and southern mesas, while visiting caravans contribute ballast salts or sky charts before receiving gliding escorts.',
      '## Aerie Hierarchies',
      'Contrary to tavern lore, harpy society is a lattice of rotating song-clans that share windwell cisterns. Leadership passes each equinox across three circles:\n\n- **Thermocline Circle** — scouts and windcallers who map updraft corridors and warn caravans with mirrored talon sweeps.\n- **Echo Circle** — lorekeepers who memorize stormballads, adjudicate disputes, and steady fledglings during first descents.\n- **Ember Circle** — harvesters cultivating embermoss, processing cloud milk, and trading guststone batteries with aerostat guilds.',
      '## Windborne Tactics',
      'Warflights emphasize disruption, with wing pairs blinding siege crews using powdered quicklime while talon cadres pierce airship envelopes via obsidian harpoons on magnetic reels. Doctrine notes from the 3rd Aerial Legion advise parley at dawn calms when Thermocline scouts must roost to recalibrate barometric chimes.',
      '## Song-Lore and Rituals',
      'Harmonized trills double as law, ledger, and welcome. Outsiders risk signaling debts if they mimic the choruses without leave. Fledglings earn their first featherbraid during the Cloudstay Vigil—an overnight suspension beneath the rookery lit only by embermoss lanterns.',
      '## Sky Trade',
      'Harpies monopolize thunderstone core delivery, bartering for salt, polished glass, finely tuned gliders, and annual grain drops arranged with the River Guild. Offering warming coils is an insult implying the aerie cannot maintain its own thermals.',
      '## Field Notes',
      '1. Dorun Pell, *Thermals, Thunder, and Treaty Songs* (Imperial Aerarium folio, 1890).\n2. Echo Circle conclave transcript with Envoy Aewyn, preserved in the Shatterglaze Archive.\n3. Skyhook Station weather almanacs covering Weeks 207–215 of the White Gale campaigns.'
    ].join('\n\n')
  },
  goblins: {
    title: 'Border Guild Goblins',
    altNames: 'Copperwire, Pitchstone, and Glassfern syndicates',
    subheader: 'Subterranean guild networks beneath market towns',
    description: [
      '![Goblin artisans negotiating in glowing forgeworks](images/33b12b7ce72e0106e8b90a95903aca37.jpg)',
      '## Overview',
      'Border Guild goblins maintain warrens that link surface plazas to foundries via freight lifts and pneumatic runners. Governance is contractual: brass-etched compacts define labor protections and security protocols, enforced by Ledger Circle arbiters whose sanctions include hidden strike teams.',
      '## Guild Networks',
      'Quarterly forums align three primary syndicates:\n\n- **Copperwire Syndic** — stewards whisperwire telegraphs and lantern towers tracking caravan movements.\n- **Pitchstone Consortium** — controls alchemical resins, blasting charges, and mining rights, fielding sandglass pistols that amber would-be thieves.\n- **Glassfern Combine** — cultivates botanical reagents and translucent armor traded to harpy aeries and riverfolk divers.',
      '## Workshop Innovations',
      'As once the men of the realm were once ignorant savages unable to build more beyond lives of savage clan warfare, so to have the Goblin race come into advancement in recent years on a similar level to humans. The clever greenskins have begun to acheive technological advancements at an alarming pace. These advancements are not universal and seemingly cultural among certain groups of goblins rather than genetic and have occured slowly over thep ast millenia, where as most Goblin tribes still live in savagery and barbarity a select few have become more cunning. Using gunpowder where before they would use sharpen bone to crack open the walls of a dwarhold. Modular tinker-cells allow furnaces to reconfigure in minutes using color-coded latch runes, while apprentices earn rank by improvising replacements for embargoed parts. Inspector Vyre documented steamworks that vent pressure through dissonant melody pipes doubling as evacuation alarms.',
      '## Markets and Finance',
      'Ledger stones keyed to palmprints route currency, and disputes settle through weighted promissory gears representing fractional cargo ownership. Neutral golem brokers guard escrow vaults during surface trade, and caravan masters split chromed chits to void agreements if negotiations sour.',
      '## Alliances and Rivalries',
      'Standing accords bind the Verdant Tide Circle for grain logistics and halfling river barges for clandestine routes, while tariffs strain relations with human duchies. Hostilities with the Stoneking dwarves persist after the Bronze Gate sabotage until the Ledger Circle yields disputed regulator schematics.',
      '## Field Notes',
      '1. Magistrate Asha Vyre, *Accounts from the Under-Market* (Treasury Case File 301-B).\n2. Ledger Circle minutes from the Brass Market Arbitration, sessions 3–6.\n3. Glassfern botanist testimonies recorded in the Embervault Tunnels, shelf 22.'
    ].join('\n\n')
  },
  'ice-trolls': {
    title: 'Ice Troll Enclaves',
    altNames: 'Shardwild glacier wardens',
    subheader: 'Breathstone-sharing kinship rooted in auroral icefields',
    description: [
      '![Ice troll guiding a glacier barge under auroras](images/420b81d51d92d31b88990525ee4628d1.jpg)',
      '## Overview',
      'Shardwild ice trolls roam glacier barges and geothermal cavern-halls, guarding ley-fed icefields that anchor ancestral memory pools. Kinship is sealed by exchanging breathstone shards carried in throat pouches, obligating mutual defense and songkeeping during thaw festivals.',
      '## Physiology and Adaptations',
      'Secondary hearts pump antifreeze serum through dermal canals, preventing frostbite even in whiteouts. Hollow tusks resonate clan signals across snowfields, while specialized adaptations include:\n\n- **Regenerative Torpor** — weeks-long trances beneath heated cairns that regrow icebone guided by carved sigils.\n- **Echo Sense** — sinus chambers mapping tunnels through low thrums that reveal intruders by their resonance frost distortions.\n- **Sunshard Veils** — crystal membranes woven into cloaks that refract glare and signal convoy routes.',
      '## Glacier Settlements',
      'Enclaves carve blue-ice shelves reinforced with basalt ribs hauled from fissures. Public halls glow with rune-etched prisms storing starlight, and dawn harmonics led by ice-wardens realign microfractures, explaining the Polar Survey\'s zero-collapse record across thirty winters.',
      '## Ritual and Memory',
      'Breathstone pools double as communal archives where elders replay ancestral deeds to teach oathweaving, binding promises sung across frozen canyons. Storykeepers engrave saga knots into their fur each solstice to record negotiations, victories, and penances.',
      '## Diplomacy and Conflict',
      'The Hoarfrost Pact allies ice trolls with frost elves and human beacon guilds, trading safe glacier passage for rune-etched copper that stabilizes breathstone caches. Ambushes under auroral veils confront fire giant forges encroaching on sacred meltwater basins, shattering arms with tusk-amplified resonance pulses.',
      '## Field Notes',
      '1. Lysa Ren, *Shardwild Observational Logs* (Polar Survey Corps Archive, Drawer 3).\n2. Dream-log fragments provided by Shaman Vreth during the Chillwater Armistice.\n3. Hoarfrost Pact trade tallies from 1891–1896, sealed in Beacon Guild vaults.'
    ].join('\n\n')
  },
  kobolds: {
    title: 'Kobolds of the Emberdeep',
    altNames: 'Burrow Choir cooperatives',
    subheader: 'Trap-savvy clutch networks within the Emberdeep caldera',
    description: [
      '![Kobolds gathering in a lava-lit cavern with banners](images/3ed13064f54fa486a48442c62c8bfb57.jpg)',
      '## Overview',
      'Emberdeep kobold warrens braid through basalt strata warmed by dormant drake vents. Clutch cooperatives pool labor for mining, trap maintenance, and tribute negotiations with patron drakes, recording tithes on glow-ink scrolls legible only beneath phosphorescent lichen.',
      '## Burrow Structure',
      'Spiral warrens align living quarters with radiant heat while ventilation shafts serve as message tubes for pebble-code rattles. Key districts include:\n\n- **Surface Apertures** — camouflaged skylights feeding lichen gardens and providing emergency egress during lava surges.\n- **Ember Galleries** — communal smelters that cycle cinders through rotating cages to prevent flare-ups.\n- **Dragon Vaults** — mirrorstone-lined tithe chambers with counterweighted floors ready to seal if diplomacy fails.',
      '## Trapcraft and Engineering',
      'Defense doctrine favors misdirection via dummy tunnels, thunder-pot echo chambers, and rolling cages that corral intruders toward negotiation platforms. Cavern Census advisories warn against tampering with lichen lanterns that hide flame siphons and recommend resonant chimes to disrupt pebble-code transmissions.',
      '## Tribute and Trade',
      'Tithes manifest as gemstone chimes tuned to a patron drake\'s favored frequencies, paired with automata that sweep volcanic ash from dragon scales. Surface commerce trades fireglass lenses, collapsible lantern poles, magma vein maps, and wartime sapper expertise for allied sieges.',
      '## Myth and Oathbinding',
      'Burrow Choir chants recount the First Ember coaxing a star-egg into the caldera. Oaths seal when kobolds press claws to heated anvilstones while reciting lineage spirals, and the decennial Sapphire Accord renewal warns that faltering the rhythm awakens the Ashwind sentinel to dissolve treacherous cooperatives.',
      '## Field Notes',
      '1. Archivist Tolan Nerys, *Emberdeep Census Rolls* (Cavern Archives, Case 12).\n2. Ironbridge collapse rescue accounts transcribed by Burrow Choir scribes.\n3. Drakespine tributary receipts from the Sapphire Accord editions 1885–1894.'
    ].join('\n\n')
  },
  'mountain-dwarfs': {
    title: 'Mountain Dwarfs of Stonefast',
    altNames: 'Forge-hearth clans of the Shatterpeak Range',
    subheader: 'Vault masons who temper basalt hearts beneath the high cols',
    description: [
      '![Mountain dwarf citadel carved into glacier cliffs](images/512f481d24643d9dc03b474546b76ed9.jpg)',
      '## Overview',
      'Stonefast citadels spiral through fault seams where aurora-lit ice meets adamant ore. Mountain dwarfs measure years by the number of anvils awakened for the winter conclave, when thawwater is sealed into resonance vaults to cool the keystones that support each level.',
      '## Clanhalls and Governance',
      'High Hearth councils include one seat for each living master mason, forge cantor, and glacier courier. Oaths are scored into load-bearing pillars, ensuring anyone who breaks a compact must chip their promise free under watch of the entire hall. Six terra cantons exchange apprentices yearly to prevent technique hoarding.',
      '## Craft and Warfare',
      'Stonefast smiths blend meteoric iron with glacier glass to produce mirror-backed axes that refract torchlight into confusing arcs. Warbands advance through pre-cut avalanche sluices, releasing powder snow curtains before shield columns emerge with sonic-hammer volleys tuned to fracture siege towers.',
      '## Trade and Diplomacy',
      'The citadels barter cold-coined promissory bars for geothermal charts and underdeep grain rights. Their embassy in the River Guild quarter demands visitors submit blades for harmonic testing; weapons that clash with the citadel pitch are reworked as goodwill gifts.',
      '## Field Notes',
      '1. Journeyman Eira Ashthumb, *Keystones of Stonefast* (Guild of Masters folio 7) detailing vault resonance protocols.\n2. Commodore Jal Orvan, siege journal entry 403 recounting failed battering ram assaults halted by avalanche sluices.\n3. River Guild attache memorandum, shelf mark RG-12-88, listing trade concessions granted after the Fourth Forge Conclave.',
    ].join('\n\n'),
  },
  'dark-dwarfs': {
    title: 'Dark Dwarfs of the Umbershade Vaults',
    altNames: 'Lanternbound clans beneath the Ashen Deep',
    subheader: 'Voidglass artisans who navigate the breathless caverns',
    description: [
      '![Dark dwarf enclave illuminated by voidglass lanterns](images/0eb7c454e6067e0f012e198528356fee.jpg)',
      '## Overview',
      'Umbershade vaults hang inverted over fumarole lakes whose fumes demand breathstone masks for passage. Dark dwarfs cultivate bioluminescent lichens along suspended catwalks, weaving glow-script warnings that ripple when tremors approach.',
      '## Lanternbound Society',
      'Clans pledge fealty to the Lantern Chorus, a guild of tone-keepers who maintain syncopated beacon songs guiding miners through the void. Justice is delivered through shadow parables recited in pitch-black chambers, where the judged must interpret hanging chimes to prove remorse.',
      '## Voidglass Craft',
      'Umbershade smelteries condense volcanic gases into voidglass panes capable of bending pressure waves. Artisans temper the panes within silence wells so they resonate only to coded tapping, letting strike teams communicate without echoing through the caverns.',
      '## Surface Relations',
      'Dark dwarf envoys trade nightwater tinctures and voidglass lenses in exchange for spice caches and aboveground seeds to rewild their fungal terraces. Diplomats arrive cloaked in soot-sheened mail that absorbs lantern glare, a courtesy to avoid blinding surface allies.',
      '## Field Notes',
      '1. Lantern Keeper Mavren\'s hymn tablets, catalogue LS-443, capturing the beacon rhythms for safe descent shafts.\n2. Professor Hesta Varr, *Echoes Without Air* (University of Caldera press, 1898) analyzing voidglass acoustic dampening.\n3. Trade manifests seized from smugglers by the River Watch, entry 22-B, detailing spice-for-nightwater exchanges.',
    ].join('\n\n'),
  },
  'hill-dwarfs': {
    title: 'Hill Dwarfs of the Sunmeadow Barrows',
    altNames: 'Barrow harvesters of the Rolling Marches',
    subheader: 'Terraced brewers who steward stone-laced vineyards',
    description: [
      '![Hill dwarf terraces with sunlit breweries](images/069c94f86058fa5fe8285a03939c93fb.jpg)',
      '## Overview',
      'Sunmeadow barrows rise as earthen domes cloaked in grapevines whose roots wind through mnemonic ossuaries. Hill dwarfs mark seasons by solstice feasts where ancestor-stones are bathed in fermenting must to awaken dream-guides for the coming year\'s plantings.',
      '## Hearth Circles',
      'Community hearths operate as rotating cooperatives: the Brewcircle tenders maintain kettles, the Seedcircle cartographers scribe soil-scent maps, and the Watchcircle outriders patrol with horn-bows that fire braided willow bolts. Council seats rotate every 28 days to ensure each circle sings in balance.',
      '## Agriculture and Craft',
      'Terraces mix mineral loam with powdered boneglass to stabilize slopes and flavor the copperleaf grapes prized by River Guild merchants. Hill dwarf coopers engineer collapsible casks for caravan trains, each etched with scent-runes that bloom when tapped to confirm authenticity.',
      '## Diplomacy and Festivals',
      'Barrow markets welcome traveling choirs who contribute verses to the Solstice Canticle. Envoys broker rain-rights with cloudmages and guarantee safe festival roads for river barges. Guests receive stone-scribed tasting slates recording the vintages they sampled as proof of hospitality rendered.',
      '## Field Notes',
      '1. Elder Bryn Willowbrace, oral history cylinder SB-23 on the founding of the tri-circle councils.\n2. Sommelier Carta Vane, *Vintages of the Rolling Marches* (Guild of Tasters ledger, 1906) cataloging copperleaf blends.\n3. River Watch dispatches, volume RW-311, reporting on hill dwarf outrider escorts during the Equinox caravan.',
    ].join('\n\n'),
  },
  yeti: {
    title: 'Shardspine Yetis',
    altNames: 'Glacier oracles of the Howling Crest',
    subheader: 'Frostbound mystics guarding auroral passes',
    description: [
      '![Yeti oracle tracing glyphs in blowing snow](images/2a7fd8c8f1331c694bc47193d356f58a.jpg)',
      '## Overview',
      'Shardspine yetis roam knife-edged ridges where aurora curtains scrape the peaks. Clans follow migrating starfalls, sheathing their white fur in crushed sapphire dust to refract hostile light. Surface caravans track their movements by the echo of bone flutes drifting through blizzards.',
      '## Habitat and Society',
      'Trance-lodges are carved within blue-ice chambers that hum with glacial resonance. Elders called **Frost-Readers** suspend crystal pendulums that record tectonic murmurs, while the **Avalanche Chorus** shapes snowpack with low-frequency throat songs. No single leader rules; decisions thaw only after each circle contributes a verse to the omen tally.',
      '## Survival Practices',
      'Yetis weave heat-trapping cloaks from snowmoss and glacier goat wool, sealing them with whale oil traded from fjord raiders. Their diet combines fermented lichen bricks, frozen marrow shards, and stormbird eggs cached in geothermal vents. When storms rage, they braid warning totems into crevasses so wanderers can tether themselves to safety lines.',
      '## Diplomacy and Lore',
      'Frostbound emissaries exchange aurora charts for star-metal chisels, insisting on moot circles held at twilight when reflections do not blind them. Storykeepers inscribe visions on obsidian plates kept in pressure-sealed reliquaries; each plate is broken only when corroborating dreams arise among allied shamans.',
      '## Field Notes',
      '1. Polar Survey Expedition Log 43-B describing pendulum omens before the 1874 icequake.\n2. Whispered translations of the Avalanche Chorus by linguist Eira Stonethaw, archived in the Boreal Library.\n3. Trade scrip ledger noting oil-for-aurora chart exchanges at Frostwind Crag during the most recent thaw conclave.',
    ].join('\n\n'),
  },
  drow: {
    title: 'Umbral Drow Enclaves',
    altNames: 'Silkwardens of the Nightroot Reaches',
    subheader: 'Nocturnal tacticians weaving bioluminescent byways',
    description: [
      '![Drow spire lit by violet fungus lanterns](images/4f3fbd924db4d0c28b4dce6b44965b26.jpg)',
      '## Overview',
      'Drow enclaves spiral around cavern pillars wrapped in nightroot vines that drink toxic spores and exhale shimmering motes. Matriarchal houses coordinate strike teams, but civic policy is set by the **Silkwarden Conclave**, a rotating assembly of archivists, arachnid handlers, and shadow diplomats.',
      '## Society and Governance',
      'Every household maintains a lumen garden where glowcap orchids are tuned to unique pulses, forming a living encryption network. Votes occur by synchronizing specific bloom patterns, allowing consensus to pulse through the cavern without spoken word. Oathbreakers lose access to the network and must navigate the dark unassisted, an exile harsher than imprisonment.',
      '## Warfare and Tactics',
      'Strike cadres glide along tensioned silk highways stretching across abyssal vaults. Venom-glass quarrels disrupt nervous systems with prismatic resonance, while pactbound spiders weave barricades that stiffen into obsidian-hard mesh. War-chants modulate fungus light to blind invaders and guide allies wearing rune-filtered goggles.',
      '## Trade and Alliances',
      'Drow caravans trade nightroot antidotes, soundless ballistae, and mirror silk garments to surface brokers under moonless skies. In return they demand relic pigments, rare meteoric iron, and contracts guaranteeing silence about the exchange routes. Diplomatic treaties are inked on shadow vellum that fades if recited without consent.',
      '## Field Notes',
      '1. Survey of Nightroot Reaches tunnels by Cartographer Velen Duskpath, folio 12.\n2. Transcript of the Silkwarden Conclave "Starlit Reckoning" session, sealed in the Eclipse Archive.\n3. Merchants\' Guild ledger entries on mirror silk deliveries during the Rainfall Accord.',
    ].join('\n\n'),
  },
  giant: {
    title: 'Skyclave Giants',
    altNames: 'Storm-anchored citadel builders',
    subheader: 'Cloudborne engineers shaping floating bastions',
    description: [
      '![Giant lifting skybridge stones amid storm clouds](images/ae0c5f3421208e8ebd61d4958ddf37ab.jpg)',
      '## Overview',
      'Skyclave giants inhabit airborne mesas tethered by lightning rods to dormant volcanoes below. Each citadel drifts within mapped jetstream corridors, nudged by colossal wind-vanes and gravity wells carved from magnetized basalt.',
      '## Social Structure',
      'Giants organize into **Anchor Lodges** led by architects who harmonize meteorological charts with ancestral epics. Apprentices earn their first stormbrand bracelet only after successfully guiding a floating garden through an equinox gale. Moots convene during thunderhead gatherings when resonance chambers amplify their basso deliberations.',
      '## Engineering and Craft',
      'Stonework incorporates stormglass conduits channeling lightning into capacitors that power lift cranes and seed warmers. Giants weave cloudwool tapestries that insulate cavernous halls and double as memory archives—touching embroidered knots plays recorded oral histories.',
      '## Relations with Grounded Folk',
      'Diplomatic cranes lower cargo capsules to mountain monasteries, exchanging weather predictions for rare pollen, meteor shards, and woven prayer flags. Ground envoys allowed aboard must undergo anti-vertigo rites involving pressure-song harmonics.',
      '## Field Notes',
      '1. Stormscribe Halvor\'s flight logs mapping jetstream corridors across the Thunder Shelf.\n2. Architect Lysa Stratos, *Treatise on Suspended Foundations*, chapter 7: Resonance Counterweights.\n3. Monastic correspondence acknowledging the Lightning Exchange Pact renewed each solstice.',
    ].join('\n\n'),
  },
  gnome: {
    title: 'Emberclock Gnomes',
    altNames: 'Tinker guilds of the Brasswood Halls',
    subheader: 'Microforge savants powering itinerant workshops',
    description: [
      '![Gnome engineers calibrating clockwork automata](images/b603ab0d14f85979142c50e4f2a19b7b.jpg)',
      '## Overview',
      'Emberclock gnomes dwell inside hollowed redwood trunks reinforced with copper spines. Their settlements rotate along seasonal trade loops, transporting modular workshops that latch onto rootway depots overnight.',
      '## Guild Circuits',
      'Three traveling guild circuits maintain balance: the **Sparksworn** calibrate arc-lanterns and magnetic relays, the **Pulsewrights** oversee automaton hearts, and the **Ledgerturners** arbitrate patents recorded on wax cylinders. Councils occur weekly at dawn whistle when all circuits sync their chronometers.',
      '## Inventions and Craftwork',
      'Signature devices include self-writing quills guided by sympathetic ink, collapsible exosuits for heavy lifting, and chirping direction beacons tuned to ley-line hum. Each invention bears a songline etched into brass so any gnome can replicate the calibration melody.',
      '## Diplomacy and Trade',
      'Emberclock caravans swap repair contracts, lightning rod upgrades, and animated relay couriers for exotic timbers, gemstone dust, and fermented teas. Guests must contribute a puzzle or riddle before entering the Great Gearhall, a tradition said to keep innovation restless.',
      '## Field Notes',
      '1. Patent cylinder registry BW-77 cataloguing automaton improvements approved last circuit.\n2. River Guild correspondence on maintenance of ley-line beacons between Brasswood and Steelwater.\n3. Traveling diary of Scholar Imoen Pell detailing puzzle etiquette among Ledgerturners.',
    ].join('\n\n'),
  },
  ratling: {
    title: 'Underrail Ratlings',
    altNames: 'Pipeway couriers of the Buried Market',
    subheader: 'Scavenger cooperatives orchestrating hidden trade spines',
    description: [
      '![Ratling brokers negotiating in lantern-lit tunnels](images/8b1c45d43af25e58471fd9b2ec687e38.jpg)',
      '## Overview',
      'Ratlings maintain labyrinthine pipeways beneath industrial quarters, mapping every maintenance shaft and forgotten cistern. Their whiskered scouts memorize vibration signatures to detect intruders long before they enter the warrens.',
      '## Collective Structure',
      'Cooperatives known as **Clatterbands** pool resources and vote via tail-knot codes tied to communal signal lines. Quartermasters record obligations on chew-resistant slate tablets coated in resin, ensuring ledgers survive steam bursts and chemical runoff.',
      '## Tradecraft and Intelligence',
      'Ratlings broker salvage rights, smuggle contraband botanicals, and run messenger relays through humming pneumatic tubes. Field agents wield wrist-mounted hooklaunchers to cross chasms, and archivists train scent-tracking ferrets to guard repository vaults.',
      '## Relations with Surface Dwellers',
      'Surface guilds respect ratling neutrality by depositing tribute caches at designated drain grates. Offenders who shortchange a tribute awaken to their warehouses rearranged overnight, inventory carefully accounted for with annotations explaining corrective interest.',
      '## Field Notes',
      '1. Buried Market manifest BM-19 cataloguing tribute exchanges during the Copper Moon.\n2. Inspector Harrow\'s testimony on ratling intervention in halting a plague-bearing barge.\n3. Tail-knot cipher primer distributed to allied couriers after the Steam-Tunnel Truce.',
    ].join('\n\n'),
  },
  troglodyte: {
    title: 'Sulfur Hollow Troglodytes',
    altNames: 'Myconic wardens of the Fumarole Veins',
    subheader: 'Bioluminary guardians thriving in caustic depths',
    description: [
      '![Troglodytes tending glowing fungus pools](images/5f5b18f639c3de5407fdbbf9784d5a53.jpg)',
      '## Overview',
      'Troglodyte communes inhabit volcanic fault lines where mineral fog shrouds obsidian terraces. Their translucent skin refracts the neon glow of alchemical fungi cultivated in tiered pools.',
      '## Physiology and Culture',
      'Residents undergo **Fume Baptisms** that acclimate lungs to sulfur-saturated air, allowing them to breathe unfiltered within vents that would choke surface folk. Communal memory is preserved through scent-coded chants—each aroma triggers specific verses carried on harmonic clicks.',
      '## Defense and Rituals',
      'Guardian cadres wield crystallized acid shards and deploy pheromone mists that disorient trespassers. Festivals commemorate eruptions with synchronized bioluminescent dances, painting the cavern ceiling with patterns interpreted by seers as omens of tectonic calm or upheaval.',
      '## External Relations',
      'Troglodytes trade stabilizing salves, glowstone capacitors, and steam-shield plating to subterranean allies. In exchange they request breathable moss spores, metal ingots resistant to corrosion, and stories recorded on scent-infused scrolls.',
      '## Field Notes',
      '1. Mineralogical survey SM-88 verifying acid shard growth cycles.\n2. Diplomacy log of Envoy Cassia Wyrmguard documenting steam-shield barter terms.\n3. Scent-scroll fragments translated by Scholar Ojun Rel, revealing the prophecy of the Twin Eruptions.',
    ].join('\n\n'),
  },
  ogre: {
    title: 'Gravelmaw Ogres',
    altNames: 'Bridge-breakers of the Shattered Span',
    subheader: 'Siege savants commanding mobile quarry camps',
    description: [
      '![Ogre engineers raising a stone bulwark](images/9f0b1c3b4a679a38796831d7a79647c1.jpg)',
      '## Overview',
      'Gravelmaw ogres roam canyon networks hauling collapsible siege foundries atop chain-dragged sledges. Their culture centers on quarrying resonant stone used to reinforce frontier bastions or, when negotiations fail, to shatter enemy keeps.',
      '## Clan Organization',
      'Clans revolve around **Spanmasters** who chart stress fractures across canyon bridges. Forge-priests maintain rhythm anvils tuned to canyon winds, ensuring every hammer strike aligns with structural weak points. Young ogres apprentice as haulrunners before earning the right to wield the clan\'s seismic mauls.',
      '## Warfare and Engineering',
      'Their weapons include ripple rams that emit focused shockwaves, collapsible rampart kits, and obsidian-tipped chain bolas capable of toppling siege towers. Defensive tactics feature layered boulder curtains rigged to drop sequentially while drummers coordinate countercharges.',
      '## Trade and Diplomacy',
      'Gravelmaw diplomats broker stone reinforcement services, demanding in return ironwood struts, alchemical lubricants, and rights to salvage battle debris. Honor feasts feature basalt-baked root stews, and treaties are etched onto balanced counterweights hung in neutral ravines.',
      '## Field Notes',
      '1. Engineer Myra Feldt\'s battlefield sketches of ripple ram deployments during the Siege of Breakwater Arch.\n2. Granite Ledger entries documenting trade agreements with the River Watch.\n3. Oral recital of Drum-Captain Rulgar describing the Pact of Three Echoes.',
    ].join('\n\n'),
  },
};

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
    return;
  }
  clearSelectedMarker();
  showInfo(entry.title, entry.altNames, entry.subheader, entry.description, entry.infobox);
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

    var defaultAlt = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
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
    var markdownPath = 'images/' + fileName;
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
})();



