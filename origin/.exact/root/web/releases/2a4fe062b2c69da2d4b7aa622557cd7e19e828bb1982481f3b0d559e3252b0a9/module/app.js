var exact = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region globe.ts
	const RAD = Math.PI / 180;
	function buildDataset(rows, origin) {
		const n = rows.length;
		const lats = new Float64Array(n);
		const lons = new Float64Array(n);
		const px = new Float64Array(n);
		const py = new Float64Array(n);
		const pz = new Float64Array(n);
		for (let i = 0; i < n; i += 1) {
			const lat = rows[i][3];
			const lon = rows[i][4];
			lats[i] = lat;
			lons[i] = lon;
			const phi = lat * RAD;
			const lam = lon * RAD;
			const cphi = Math.cos(phi);
			px[i] = cphi * Math.cos(lam);
			py[i] = cphi * Math.sin(lam);
			pz[i] = Math.sin(phi);
		}
		return {
			origin,
			rows,
			lats,
			lons,
			px,
			py,
			pz
		};
	}
	function parseSeed(text) {
		if (!text || text === "[]") return [];
		try {
			const parsed = JSON.parse(text);
			if (!Array.isArray(parsed)) return [];
			const out = [];
			for (const row of parsed) if (Array.isArray(row) && row.length >= 5 && typeof row[0] === "string" && typeof row[3] === "number") out.push(row);
			return out;
		} catch (_unused) {
			return [];
		}
	}
	function haversine(lat1, lon1, lat2, lon2) {
		const dLat = (lat2 - lat1) * RAD;
		const dLon = (lon2 - lon1) * RAD;
		const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
		return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
	}
	function nearestIn(dataset, lat, lon, want) {
		const hits = [];
		const { lats, lons, rows } = dataset;
		const n = rows.length;
		for (let i = 0; i < n; i += 1) {
			const km = haversine(lat, lon, lats[i], lons[i]);
			if (hits.length < want) {
				hits.push({
					row: rows[i],
					km
				});
				if (hits.length === want) hits.sort((a, b) => a.km - b.km);
			} else if (km < hits[hits.length - 1].km) {
				hits[hits.length - 1] = {
					row: rows[i],
					km
				};
				let j = hits.length - 1;
				while (j > 0 && hits[j - 1].km > hits[j].km) {
					const t = hits[j - 1];
					hits[j - 1] = hits[j];
					hits[j] = t;
					j -= 1;
				}
			}
		}
		return hits;
	}
	//#endregion
	//#region data/globe-seed.ts
	const GLOBE_SEED = [];
	//#endregion
	//#region \0@oxc-project+runtime@0.150.0/helpers/esm/asyncToGenerator.js
	function _asyncToGenerator(fn) {
		return function() {
			var self = this, args = arguments, context = globalThis.__exact_async_context, at = context ? context.current() : void 0;
			return new (context && context.Promise || Promise)(function(resolve, reject) {
				var gen = fn.apply(self, args);
				function step(key, arg) {
					if (context && context.route && context.route(at, step, key, arg)) return;
					var before = context ? context.swap(at) : void 0, info;
					try {
						info = gen[key](arg);
					} catch (error) {
						if (context) context.swap(before);
						reject(error);
						return;
					}
					if (context) context.swap(before);
					if (info.done) resolve(info.value);
					else Promise.resolve(info.value).then(function(v) {
						step("next", v);
					}, function(e) {
						step("throw", e);
					});
				}
				step("next", void 0);
			});
		};
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.150.0/helpers/esm/typeof.js
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof(o);
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.150.0/helpers/esm/toPrimitive.js
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.150.0/helpers/esm/toPropertyKey.js
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.150.0/helpers/esm/defineProperty.js
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	//#endregion
	//#region \0@oxc-project+runtime@0.150.0/helpers/esm/objectSpread2.js
	function ownKeys(e, r) {
		var t = Object.keys(e);
		if (Object.getOwnPropertySymbols) {
			var o = Object.getOwnPropertySymbols(e);
			r && (o = o.filter(function(r) {
				return Object.getOwnPropertyDescriptor(e, r).enumerable;
			})), t.push.apply(t, o);
		}
		return t;
	}
	function _objectSpread2(e) {
		for (var r = 1; r < arguments.length; r++) {
			var t = null != arguments[r] ? arguments[r] : {};
			r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
				_defineProperty(e, r, t[r]);
			}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
				Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
			});
		}
		return e;
	}
	//#endregion
	//#region app.ts
	const PRIMARY = "https://de1.api.radio-browser.info";
	const ALIAS = "https://all.api.radio-browser.info";
	const FAVORITES = "app:/data/favorites.json";
	const RECENT = "app:/data/recent.json";
	const RECENT_LIMIT = 20;
	const SEARCHES = "app:/data/searches.json";
	const SEARCH_LIMIT = 8;
	const PAGE = 40;
	const GLOBE_CACHE = "app:/cache/globe.json";
	const UA = "Airwave/0.1 (Exact; radio-browser client)";
	const grants$1 = [
		`net.fetch ${PRIMARY}`,
		`net.fetch ${ALIAS}`,
		"fs.read app:/data",
		"fs.write app:/data",
		"fs.read app:/cache",
		"fs.write app:/cache"
	].join("\n");
	/** A stable "dial position" per station, so the radio face reads the same every time. */
	function emptyStation() {
		return {
			id: "",
			name: "",
			tagline: "",
			stream: "",
			fallback: "",
			favicon: "",
			country: "",
			countryCode: "",
			tags: [],
			codec: "",
			bitrate: 0,
			votes: 0,
			clicks: 0,
			frequency: 0,
			lat: 0,
			lon: 0,
			distanceKm: 0
		};
	}
	function freqOf(id) {
		let hash = 2166136261;
		for (let i = 0; i < id.length; i += 1) {
			hash ^= id.charCodeAt(i);
			hash = Math.imul(hash, 16777619);
		}
		const spot = Math.abs(hash) % 201;
		return Math.round((87.5 + spot / 10) * 10) / 10;
	}
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const FILTERS = {
		hidebroken: "true",
		is_https: "true",
		order: "clickcount",
		reverse: "true"
	};
	function qs(params) {
		return Object.keys(params).map((key) => `${key}=${encodeURIComponent(String(params[key]))}`).join("&");
	}
	let base = PRIMARY;
	function getJson(_x2) {
		return _getJson.apply(this, arguments);
	}
	function _getJson() {
		_getJson = _asyncToGenerator(function* (path) {
			const attempt = function() {
				var _ref = _asyncToGenerator(function* (b) {
					return fetch(`${b}${path}`, {
						headers: { "user-agent": UA },
						exactTimeout: 8e3
					});
				});
				return function attempt(_x) {
					return _ref.apply(this, arguments);
				};
			}();
			let response;
			try {
				response = yield attempt(base);
			} catch (e) {
				if (e.code === "bake") throw e;
				base = base === PRIMARY ? ALIAS : PRIMARY;
				response = yield attempt(base);
			}
			if (!response.ok) throw new Error(`The station index answered ${response.status}.`);
			return response.json();
		});
		return _getJson.apply(this, arguments);
	}
	function asString(value) {
		return typeof value === "string" ? value : "";
	}
	function asNumber(value) {
		return typeof value === "number" && Number.isFinite(value) ? value : 0;
	}
	let globeData = null;
	const GLOBE_SAMPLE = [
		[
			"bbc-world",
			"BBC World Service",
			"https://stream.live.vc.bbcmedia.co.uk/bbc_world_service",
			51.5,
			-.12,
			"",
			"AAC",
			0,
			"GB",
			"news",
			900
		],
		[
			"radio-france",
			"France Inter",
			"https://icecast.radiofrance.fr/franceinter-midfi.mp3",
			48.86,
			2.35,
			"",
			"MP3",
			128,
			"FR",
			"general",
			500
		],
		[
			"nhk-tokyo",
			"NHK Radio 1",
			"https://netradio-live2.nhk.jp/hls/live/200170/nhkradiru1l/master.m3u8",
			35.68,
			139.69,
			"",
			"AAC",
			0,
			"JP",
			"news",
			400
		],
		[
			"kexp-seattle",
			"KEXP",
			"https://kexp.streamguys1.com/kexp160.aac",
			47.6,
			-122.33,
			"",
			"AAC",
			160,
			"US",
			"alternative",
			800
		],
		[
			"abc-sydney",
			"ABC Triple J",
			"https://live-radio01.mediahubaustralia.com/2TJW/aac/",
			-33.87,
			151.21,
			"",
			"AAC",
			128,
			"AU",
			"alternative",
			300
		]
	];
	function seedRows(seed) {
		if (!Array.isArray(seed)) return [];
		return seed.filter((row) => Array.isArray(row) && row.length >= 11 && typeof row[0] === "string" && typeof row[3] === "number");
	}
	function bootGlobe(_x3) {
		return _bootGlobe.apply(this, arguments);
	}
	function _bootGlobe() {
		_bootGlobe = _asyncToGenerator(function* (storage) {
			try {
				const bytes = yield storage.fs.readFile(GLOBE_CACHE);
				const rows = parseSeed(decoder.decode(bytes));
				if (rows.length > 0) {
					globeData = buildDataset(rows, "cache");
					return {
						rev: 1,
						count: rows.length,
						origin: "cache"
					};
				}
			} catch (_unused) {}
			const seeded = seedRows(GLOBE_SEED);
			if (seeded.length > 0) {
				globeData = buildDataset(seeded, "seed");
				return {
					rev: 1,
					count: seeded.length,
					origin: "seed"
				};
			}
			try {
				return yield fetchGlobe(1, storage);
			} catch (_unused2) {
				globeData = buildDataset(GLOBE_SAMPLE, "sample");
				return {
					rev: 1,
					count: GLOBE_SAMPLE.length,
					origin: "sample"
				};
			}
		});
		return _bootGlobe.apply(this, arguments);
	}
	function seedRowOf(raw) {
		if (!raw || typeof raw !== "object") return null;
		const row = raw;
		const id = asString(row.stationuuid);
		const stream = asString(row.url_resolved) || asString(row.url);
		const lat = asNumber(row.geo_lat);
		const lon = asNumber(row.geo_long);
		if (!id || !/^https:\/\//i.test(stream)) return null;
		if (stream.includes("${") || stream.includes("`")) return null;
		if (lat === 0 && lon === 0) return null;
		if (asNumber(row.hls) !== 0) return null;
		if (PLAYLIST.test(stream)) return null;
		const favicon = asString(row.favicon);
		const codec = asString(row.codec).toUpperCase();
		const tag = asString(row.tags).split(",")[0].trim();
		return [
			id,
			cleanName(asString(row.name), hostOf(stream)).slice(0, 64),
			stream.slice(0, 180),
			Math.round(lat * 1e3) / 1e3,
			Math.round(lon * 1e3) / 1e3,
			/^https:\/\//i.test(favicon) ? favicon.slice(0, 120) : "",
			codec === "UNKNOWN" ? "" : codec.slice(0, 8),
			asNumber(row.bitrate),
			asString(row.countrycode).slice(0, 2),
			tag.slice(0, 24),
			asNumber(row.votes)
		];
	}
	function fetchGlobe(_x4, _x5) {
		return _fetchGlobe.apply(this, arguments);
	}
	function _fetchGlobe() {
		_fetchGlobe = _asyncToGenerator(function* (rev, storage) {
			try {
				const rows = [];
				const seen = /* @__PURE__ */ new Set();
				for (let offset = 0; offset < 12e3; offset += 4e3) {
					const raw = yield getJson(`/json/stations/search?${qs({
						hidebroken: "true",
						is_https: "true",
						has_geo_info: "true",
						order: "votes",
						reverse: "true",
						limit: 4e3,
						offset
					})}`);
					if (!Array.isArray(raw)) break;
					for (const item of raw) {
						const row = seedRowOf(item);
						if (row && !seen.has(row[0])) {
							seen.add(row[0]);
							rows.push(row);
						}
					}
					if (raw.length < 4e3) break;
				}
				if (rows.length === 0) throw new Error("The station index answered no geo-tagged stations.");
				globeData = buildDataset(rows, "net");
				try {
					yield storage.fs.atomicWriteFile(GLOBE_CACHE, encoder.encode(JSON.stringify(rows)));
				} catch (_unused3) {}
				return {
					rev,
					count: rows.length,
					origin: "net"
				};
			} finally {}
		});
		return _fetchGlobe.apply(this, arguments);
	}
	function hostOf(url) {
		const match = /^https?:\/\/([^/?#]+)/i.exec(url);
		return match ? match[1].replace(/^www\./i, "") : "";
	}
	function cleanName(raw, fallback) {
		let name = raw.trim();
		const bar = name.indexOf("||");
		if (bar > 0) name = name.slice(0, bar);
		name = name.replace(/\s+/g, " ").trim();
		if (!name) name = fallback || "Radio station";
		return name.length > 72 ? `${name.slice(0, 71).trimEnd()}…` : name;
	}
	const SHORT_COUNTRY = {
		"The United States Of America": "USA",
		"The United Kingdom Of Great Britain And Northern Ireland": "UK",
		"United States": "USA",
		"United Kingdom": "UK",
		"The Russian Federation": "Russia",
		"Russian Federation": "Russia",
		"The Netherlands": "Netherlands",
		"Czech Republic": "Czechia",
		"The Republic Of North Macedonia": "North Macedonia",
		"Korea, Republic of": "South Korea",
		"Republic of Korea": "South Korea",
		"The Republic Of Korea": "South Korea",
		"Iran, Islamic Republic of": "Iran",
		"The Islamic Republic Of Iran": "Iran",
		"Bolivarian Republic of Venezuela": "Venezuela",
		"The Bolivarian Republic Of Venezuela": "Venezuela",
		"United Republic of Tanzania": "Tanzania",
		"Syrian Arab Republic": "Syria",
		"Viet Nam": "Vietnam",
		"Türkiye": "Türkiye"
	};
	const SHORT_LANG = {
		english: "英语",
		german: "德语",
		french: "法语",
		spanish: "西班牙语",
		italian: "意大利语",
		russian: "俄语",
		chinese: "中文",
		japanese: "日语",
		portuguese: "葡萄牙语",
		dutch: "荷兰语",
		polish: "波兰语",
		turkish: "土耳其语"
	};
	function titleCase(name) {
		const known = SHORT_LANG[name.toLowerCase()];
		if (known) return known;
		return name.charAt(0).toUpperCase() + name.slice(1);
	}
	function shortCountry(country) {
		var _SHORT_COUNTRY$countr;
		return (_SHORT_COUNTRY$countr = SHORT_COUNTRY[country]) !== null && _SHORT_COUNTRY$countr !== void 0 ? _SHORT_COUNTRY$countr : country.replace(/^The\s+/i, "");
	}
	const PLAYLIST = /\.(?:m3u8|m3u|pls)(?:[?#]|$)/i;
	function fallbackFor(url, stream) {
		if (!/^https:\/\//i.test(url) || url === stream || PLAYLIST.test(url)) return "";
		return url;
	}
	function normalize(raw) {
		if (!raw || typeof raw !== "object") return null;
		const row = raw;
		const id = asString(row.stationuuid);
		const stream = asString(row.url_resolved) || asString(row.url);
		if (!id || !/^https:\/\//i.test(stream)) return null;
		if (asNumber(row.hls) !== 0) return null;
		if (PLAYLIST.test(stream)) return null;
		const favicon = asString(row.favicon);
		const tags = asString(row.tags).split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0).slice(0, 6);
		const country = shortCountry(asString(row.country));
		const codecRaw = asString(row.codec).toUpperCase();
		const codec = codecRaw === "UNKNOWN" ? "" : codecRaw;
		const bitrate = asNumber(row.bitrate);
		return {
			id,
			name: cleanName(asString(row.name), hostOf(stream)),
			tagline: [country, tags.slice(0, 2).join(" · ")].filter((part) => part.length > 0).join(" · "),
			stream,
			fallback: fallbackFor(asString(row.url), stream),
			favicon: /^https:\/\//i.test(favicon) ? favicon : "",
			country,
			countryCode: asString(row.countrycode),
			tags,
			codec,
			bitrate: bitrate > 0 ? Math.round(bitrate) : 0,
			votes: asNumber(row.votes),
			clicks: asNumber(row.clickcount),
			frequency: freqOf(id),
			lat: asNumber(row.geo_lat),
			lon: asNumber(row.geo_long),
			distanceKm: 0
		};
	}
	function toStations(raw) {
		if (!Array.isArray(raw)) return [];
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		for (const item of raw) {
			const station = normalize(item);
			if (station && !seen.has(station.id)) {
				seen.add(station.id);
				out.push(station);
			}
		}
		return out;
	}
	function isStation(value) {
		if (!value || typeof value !== "object") return false;
		const s = value;
		return typeof s.id === "string" && typeof s.name === "string" && typeof s.stream === "string";
	}
	function readJson(_x6, _x7, _x8) {
		return _readJson.apply(this, arguments);
	}
	function _readJson() {
		_readJson = _asyncToGenerator(function* (storage, path, keep) {
			try {
				const parsed = JSON.parse(decoder.decode(yield storage.fs.readFile(path)));
				if (!Array.isArray(parsed)) return [];
				const out = [];
				for (const item of parsed) {
					const kept = keep(item);
					if (kept !== null) out.push(kept);
				}
				return out;
			} catch (_unused4) {
				return [];
			}
		});
		return _readJson.apply(this, arguments);
	}
	function readStrings(storage, path) {
		return readJson(storage, path, (v) => typeof v === "string" && v.trim() !== "" ? v : null);
	}
	function readStations(storage, path) {
		return readJson(storage, path, (v) => {
			if (!isStation(v)) return null;
			return _objectSpread2(_objectSpread2({}, v), {}, {
				frequency: Number.isFinite(v.frequency) ? v.frequency : freqOf(v.id),
				lat: Number.isFinite(v.lat) ? v.lat : 0,
				lon: Number.isFinite(v.lon) ? v.lon : 0,
				fallback: typeof v.fallback === "string" ? v.fallback : ""
			});
		});
	}
	function writeJson(_x9, _x10, _x11) {
		return _writeJson.apply(this, arguments);
	}
	function _writeJson() {
		_writeJson = _asyncToGenerator(function* (storage, path, value) {
			try {
				yield storage.fs.atomicWriteFile(path, encoder.encode(JSON.stringify(value)));
			} catch (e) {
				if (e.code === "bake") return;
				throw e;
			}
		});
		return _writeJson.apply(this, arguments);
	}
	const feeds = /* @__PURE__ */ new Map();
	const FEED_LIMIT = 12;
	function pageOf(_x12, _x13, _x14, _x15, _x16, _x17) {
		return _pageOf.apply(this, arguments);
	}
	function _pageOf() {
		_pageOf = _asyncToGenerator(function* (kind, value, query, offset, lang, codec) {
			const filters = _objectSpread2(_objectSpread2({}, FILTERS), {}, {
				limit: PAGE,
				offset
			});
			if (kind === "tag") filters.tagExact = value;
			else if (kind === "country") filters.countrycode = value;
			else if (kind === "search") filters.name = query;
			if (lang !== "") filters.language = lang;
			if (codec !== "") filters.codec = codec;
			const raw = yield getJson(`/json/stations/search?${qs(filters)}`);
			return {
				rows: toStations(raw),
				raw: Array.isArray(raw) ? raw.length : 0
			};
		});
		return _pageOf.apply(this, arguments);
	}
	function feed(_x18, _x19, _x20, _x21) {
		return _feed.apply(this, arguments);
	}
	function _feed() {
		_feed = _asyncToGenerator(function* (kind, value, query, want, lang = "", codec = "") {
			const key = `${kind}|${value}|${query}|${lang}|${codec}`;
			let f = feeds.get(key);
			if (!f) {
				f = {
					items: [],
					raw: 0,
					done: false
				};
				if (feeds.size >= FEED_LIMIT) {
					const oldest = feeds.keys().next().value;
					feeds.delete(oldest);
				}
				feeds.set(key, f);
			}
			while (f.items.length < want && !f.done) {
				const page = yield pageOf(kind, value, query, f.raw, lang, codec);
				f.raw += page.raw;
				const seen = new Set(f.items.map((s) => s.id));
				for (const station of page.rows) if (!seen.has(station.id)) {
					f.items.push(station);
					seen.add(station.id);
				}
				if (page.raw < PAGE) f.done = true;
			}
			return f.items.slice(0, want);
		});
		return _feed.apply(this, arguments);
	}
	function reportClick(id) {
		fetch(`${base}/json/url/${encodeURIComponent(id)}`, {
			headers: { "user-agent": UA },
			exactTimeout: 5e3
		}).catch(() => void 0);
	}
	const sources = {
		globeLoad: function() {
			var _ref2 = _asyncToGenerator(function* ([rev], _store, storage) {
				return rev <= 1 ? bootGlobe(storage) : fetchGlobe(rev, storage);
			});
			return function globeLoad(_x22, _x23, _x24) {
				return _ref2.apply(this, arguments);
			};
		}(),
		mapPins: function() {
			var _ref3 = _asyncToGenerator(function* ([lat, lon, zoom, _rev]) {
				if (!globeData) return [];
				const { rows, lats, lons } = globeData;
				const radiusKm = 66e3 / Math.pow(2, zoom);
				const cap = zoom <= 2 ? 250 : zoom <= 4 ? 400 : 600;
				const idx = [];
				for (let i = 0; i < rows.length; i += 1) if (haversine(lat, lon, lats[i], lons[i]) <= radiusKm) idx.push(i);
				if (idx.length > cap) {
					idx.sort((a, b) => asNumber(rows[b][10]) - asNumber(rows[a][10]));
					idx.length = cap;
				} else if (idx.length < 40) {
					const near = nearestIn(globeData, lat, lon, 40);
					const seen = new Set(idx);
					for (const { row } of near) {
						const j = rows.indexOf(row);
						if (j >= 0 && !seen.has(j)) {
							seen.add(j);
							idx.push(j);
						}
					}
				}
				return idx.map((i) => {
					const r = rows[i];
					return {
						id: r[0],
						latitude: asNumber(r[3]),
						longitude: asNumber(r[4]),
						title: r[1]
					};
				});
			});
			return function mapPins(_x25) {
				return _ref3.apply(this, arguments);
			};
		}(),
		stationById: function() {
			var _ref4 = _asyncToGenerator(function* ([id, camLat, camLon]) {
				if (!globeData) return emptyStation();
				const row = globeData.rows.find((r) => r[0] == id);
				if (!row) return emptyStation();
				return {
					id: row[0],
					name: row[1],
					tagline: [row[8], row[9]].filter(Boolean).join(" · "),
					stream: row[2],
					fallback: "",
					favicon: row[5],
					country: row[8],
					countryCode: row[8],
					tags: row[9] ? [row[9]] : [],
					codec: row[6],
					bitrate: asNumber(row[7]),
					votes: asNumber(row[10]),
					clicks: 0,
					frequency: freqOf(row[0]),
					lat: asNumber(row[3]),
					lon: asNumber(row[4]),
					distanceKm: Math.round(haversine(camLat, camLon, asNumber(row[3]), asNumber(row[4])) * 10) / 10
				};
			});
			return function stationById(_x26) {
				return _ref4.apply(this, arguments);
			};
		}(),
		feed: function() {
			var _ref5 = _asyncToGenerator(function* ([kind, value, query, want, lang, codec]) {
				if (kind === "search" && query.trim() === "") return [];
				return feed(kind, value, kind === "search" ? query.trim() : "", Math.max(PAGE, want), lang !== null && lang !== void 0 ? lang : "", codec !== null && codec !== void 0 ? codec : "");
			});
			return function feed(_x27) {
				return _ref5.apply(this, arguments);
			};
		}(),
		languages: function() {
			var _ref6 = _asyncToGenerator(function* () {
				try {
					const raw = yield getJson("/json/languages");
					if (!Array.isArray(raw)) return [];
					return raw.filter((r) => typeof r.name === "string" && r.name.trim() !== "" && r.stationcount > 0).sort((a, b) => b.stationcount - a.stationcount).slice(0, 10).map((r) => ({
						code: r.name.trim(),
						name: titleCase(r.name.trim())
					}));
				} catch (_unused5) {
					return [];
				}
			});
			return function languages() {
				return _ref6.apply(this, arguments);
			};
		}(),
		randomStation: function() {
			var _ref7 = _asyncToGenerator(function* ([rev, exclude, lat, lon, radiusKm]) {
				var _rows$find;
				const filters = {
					hidebroken: "true",
					is_https: "true",
					has_geo_info: "true",
					order: "random",
					limit: 8
				};
				if (lat !== 0 || lon !== 0) {
					filters.geo_lat = lat.toFixed(3);
					filters.geo_long = lon.toFixed(3);
					filters.geo_distance = Math.round(Math.max(10, radiusKm) * 1e3);
				}
				const rows = toStations(yield getJson(`/json/stations/search?${qs(filters)}`));
				const station = (_rows$find = rows.find((row) => row.id !== exclude)) !== null && _rows$find !== void 0 ? _rows$find : rows[0];
				return station ? [{
					rev,
					station
				}] : [];
			});
			return function randomStation(_x28) {
				return _ref7.apply(this, arguments);
			};
		}(),
		searchHistory: function() {
			var _ref8 = _asyncToGenerator(function* (_args, _store, storage) {
				return readStrings(storage, SEARCHES);
			});
			return function searchHistory(_x29, _x30, _x31) {
				return _ref8.apply(this, arguments);
			};
		}(),
		pushSearch: function() {
			var _ref9 = _asyncToGenerator(function* ([query], _store, storage) {
				const next = [query, ...(yield readStrings(storage, SEARCHES)).filter((q) => q !== query)].slice(0, SEARCH_LIMIT);
				yield writeJson(storage, SEARCHES, next);
				return {
					ok: true,
					favorited: false
				};
			});
			return function pushSearch(_x32, _x33, _x34) {
				return _ref9.apply(this, arguments);
			};
		}(),
		loadFavorites: function() {
			var _ref10 = _asyncToGenerator(function* (_args, _store, storage) {
				return readStations(storage, FAVORITES);
			});
			return function loadFavorites(_x35, _x36, _x37) {
				return _ref10.apply(this, arguments);
			};
		}(),
		toggleFavorite: function() {
			var _ref11 = _asyncToGenerator(function* ([station], _store, storage) {
				const kept = yield readStations(storage, FAVORITES);
				const exists = kept.some((s) => s.id === station.id);
				const next = exists ? kept.filter((s) => s.id !== station.id) : [station, ...kept];
				yield writeJson(storage, FAVORITES, next);
				return {
					ok: true,
					favorited: !exists
				};
			});
			return function toggleFavorite(_x38, _x39, _x40) {
				return _ref11.apply(this, arguments);
			};
		}(),
		loadRecent: function() {
			var _ref12 = _asyncToGenerator(function* (_args, _store, storage) {
				return readStations(storage, RECENT);
			});
			return function loadRecent(_x41, _x42, _x43) {
				return _ref12.apply(this, arguments);
			};
		}(),
		pushRecent: function() {
			var _ref13 = _asyncToGenerator(function* ([station], _store, storage) {
				const kept = yield readStations(storage, RECENT);
				yield writeJson(storage, RECENT, [station, ...kept.filter((s) => s.id !== station.id)].slice(0, RECENT_LIMIT));
				reportClick(station.id);
				return {
					ok: true,
					favorited: false
				};
			});
			return function pushRecent(_x44, _x45, _x46) {
				return _ref13.apply(this, arguments);
			};
		}()
	};
	const answer$1 = (source, args, store, storage, native) => sources[source](args, store, storage, native);
	const appId = "com.lizhuo.airwave";
	const grants = grants$1;
	const answer = answer$1;
	const overlay = void 0;
	const tools = void 0;
	//#endregion
	exports.abi = 1;
	exports.answer = answer;
	exports.appId = appId;
	exports.grants = grants;
	exports.overlay = overlay;
	exports.tools = tools;
	return exports;
})({});
