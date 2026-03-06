require("dotenv").config({
	quiet: true
});
const mineflayer = require("mineflayer");
const fs = require("fs");
const {
	table
} = require("table");
const NAME = process.env.NAME || "Bot";
const CNT = parseInt(process.env.CNT || "1", 10);
const PASSWORD = process.env.PASSWORD;
const HOST = process.env.HOST || "localhost";
const PORT = process.env.PORT || 25565;
const VERSION = process.env.VERSION || "1.21.11";
const LOG = process.env.LOG === "true";
const botNames = [];
const botOnline = [];
const botPos = [];
const dataTypes = {
	1: 1,
	2: 2,
	3: 3,
	vec3i: 1,
	chunk: 2,
	azimuth: 3
};
const operations = {
	0: 1,
	1: 2,
	2: 1,
	track: 1,
	update: 1,
	untrack: 2
};
var players = {};
var playerss = [];
var waypoints = {};
var waypointss = [];
var waypointss2 = [];
var dimension = [];
var on = true;
if (LOG) {
	fs.mkdirSync("log", {
		recursive: true
	})
}
let stream;
if (LOG) {
	stream = fs.createWriteStream("log/latest.txt", {
		flags: "a"
	})
}

function appendLog(...text) {
	if (!LOG || !stream) {
		return
	}
	stream.write(text.join(" ") + "\n")
}
if (LOG) {
	let shuttingDown = false;

	function gracefulShutdown(reason) {
		if (shuttingDown) {
			return
		}
		shuttingDown = true;
		console.log("Shutting down due to:", reason);
		stream.end(() => {
			fs.fsync(stream.fd, () => {
				process.exit()
			})
		})
	}
	process.on("exit", () => {
		try {
			fs.fsyncSync(stream.fd)
		} catch {}
	});
	process.on("SIGINT", () => gracefulShutdown("SIGINT"));
	process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
	process.on("uncaughtException", err => {
		console.error(err);
		gracefulShutdown("uncaughtException")
	});
	process.on("unhandledRejection", err => {
		console.error(err);
		gracefulShutdown("unhandledRejection")
	})
}

function showTable(data, showKey = true, valueKeys = []) {
	let headers = [];
	let rows = [];
	const ty = Array.isArray(data) ? 1 : typeof data === "object" && data !== null ? 2 : 0;
	if (!ty) {
		return
	}
	if (ty === 1) {
		data = data.map((e, i) => [i, e])
	} else {
		data = Object.entries(data)
	}
	const keyName = showKey === true ? ty === 1 ? "Index" : "Key" : typeof showKey === "string" ? showKey : null;
	if (keyName) {
		headers.push(keyName)
	}
	if (!Array.isArray(valueKeys)) {
		valueKeys = [valueKeys]
	}
	if (!valueKeys.length) {
		valueKeys = [...new Set(data.flatMap(([, value]) => typeof value === "object" && value !== null ? Object.keys(value) : []))]
	}
	const nValueKeys = valueKeys?.length ? valueKeys : ["Value"];
	headers.push(...nValueKeys);
	rows = data.map(([key, value]) => {
		let row = [];
		if (keyName) {
			row.push(key)
		}
		let nValue = [];
		if (Array.isArray(value)) {
			nValue = [...value]
		} else if (typeof value === "object" && value !== null) {
			if (valueKeys.length) {
				nValue = valueKeys.map(k => value[k])
			} else {
				nValue = Object.values(value)
			}
		} else {
			nValue = [value]
		}
		nValue.length = nValueKeys.length;
		nValue = nValue.map(e => e ?? "");
		row.push(...nValue);
		return row
	});
	console.log(table([headers, ...rows]))
}

function updateData() {
	if (on) {
		console.log("Online players");
		showTable(players, "UUID", "Name");
		console.log("Bots");
		const botStat = botNames.map((name, i) => [name, botOnline[i] ? dimension[i] : "Offline", botOnline[i] ? botPos[i] : ""]);
		showTable(botStat, true, ["Name", "Dimension", "Position"]);
		console.log("Position");
		const wp = Object.entries(waypoints);
		if (!wp.length) {
			console.log("No player found")
		} else {
			wp.forEach(([dimension, waypoints2]) => {
				if (dimension) {
					console.group("Dimension:", dimension);
					showTable(Object.entries(waypoints2), true, ["Name", "Position"]);
					console.groupEnd()
				}
			})
		}
		if (LOG) {
			appendLog("[Players]", JSON.stringify(players));
			appendLog("[Bots]", JSON.stringify(botStat));
			if (wp.length) {
				appendLog("[Position]", JSON.stringify(waypoints))
			}
		}
	}
}

function updatePlayers() {
	const nPlayers = {};
	playerss.forEach(ps => {
		Object.entries(ps).forEach(([uuid, name]) => {
			nPlayers[uuid] = name
		})
	});
	if (JSON.stringify(players) !== JSON.stringify(nPlayers)) {
		players = nPlayers;
		updateData()
	}
}

function getPos(rays) {
	const dirs = rays.map(r => {
		const dx = -Math.sin(r.azimuth);
		const dz = Math.cos(r.azimuth);
		return {
			dx,
			dz
		}
	});
	const weights = rays.map((_, i) => {
		let w = 0;
		for (let j = 0; j < rays.length; j++) {
			if (i === j) {
				continue
			}
			const dot = dirs[i].dx * dirs[j].dx + dirs[i].dz * dirs[j].dz;
			const sin = Math.sqrt(1 - dot * dot);
			w += sin
		}
		return w || .001
	});
	let Axx = 0,
		Axz = 0,
		Azz = 0;
	let Bx = 0,
		Bz = 0;
	for (let i = 0; i < rays.length; i++) {
		const r = rays[i];
		const w = weights[i];
		const x0 = r.position.x;
		const z0 = r.position.z;
		const dx = dirs[i].dx;
		const dz = dirs[i].dz;
		const nx = -dz;
		const nz = dx;
		Axx += w * nx * nx;
		Axz += w * nx * nz;
		Azz += w * nz * nz;
		const dot = nx * x0 + nz * z0;
		Bx += w * nx * dot;
		Bz += w * nz * dot
	}
	const det = Axx * Azz - Axz * Axz;
	if (Math.abs(det) < 1e-8) {
		return null
	}
	return {
		x: Math.floor((Azz * Bx - Axz * Bz) / det),
		z: Math.floor((Axx * Bz - Axz * Bx) / det)
	}
}

function updateWaypoints() {
	const dataPos = {};
	const dataPos2 = {};
	const dataChunk = {};
	const dataAzimuths = {};
	waypointss.forEach((way, i) => {
		const dim = dimension[i];
		Object.entries(way).forEach(([uuid, {
			type,
			data
		}]) => {
			const name = players[uuid];
			if (!name || botNames.includes(name) || !dataTypes[type]) {
				return
			}
			switch (dataTypes[type]) {
				case 1: {
					if (!dataPos[dim]) {
						dataPos[dim] = {}
					}
					dataPos[dim][name] = `${data.x} ${data.y} ${data.z}`;
					break
				}
				case 2: {
					if (!dataChunk[dim]) {
						dataChunk[dim] = {}
					}
					dataChunk[dim][name] = `${data.chunkX*16} ? ${data.chunkZ*16}`;
					break
				}
				case 3: {
					if (!dataAzimuths[dim]) {
						dataAzimuths[dim] = {}
					}
					if (!dataAzimuths[dim][name]) {
						dataAzimuths[dim][name] = []
					}
					dataAzimuths[dim][name].push(data);
					break
				}
			}
		})
	});
	waypointss2.forEach((way, i) => {
		const dim = dimension[i];
		way.forEach(([uuid, pos]) => {
			const name = players[uuid];
			if (!name || botNames.includes(name)) {
				return
			}
			if (!dataPos2[dim]) {
				dataPos2[dim] = {}
			}
			dataPos2[dim][name] = pos
		})
	});
	const newWaypoints = [...new Set([...Object.keys(dataPos), ...Object.keys(dataPos2), ...Object.keys(dataChunk), ...Object.keys(dataAzimuths)])].reduce((acc, key) => {
		acc[key] = {
			...dataChunk[key],
			...dataPos[key],
			...dataPos2[key]
		};
		if (dataAzimuths[key]) {
			Object.entries(dataAzimuths[key]).forEach(([name, rays]) => {
				if (!acc[key][name]) {
					const pos = getPos(rays);
					if (pos) {
						acc[key][name] = `${pos.x} ? ${pos.z}`
					}
				}
			})
		}
		return acc
	}, {});
	if (JSON.stringify(waypoints) !== JSON.stringify(newWaypoints)) {
		waypoints = newWaypoints;
		updateData()
	}
}

function createManagedBot(index) {
	const username = `${NAME}${index}`;
	botOnline.push(false);
	botPos.push("");
	botNames.push(username);
	let delay = 100;
	const MAX_DELAY = 1e4;
	let bot = null;
	let timer = null;

	function connect() {
		const options = {
			host: HOST,
			port: PORT,
			username,
			auth: "offline",
			respawn: true,
			version: VERSION
		};
		bot = mineflayer.createBot(options);
		bot.autoRespawn = true;
		bot.on("physicsTick", () => {
			if (!bot.controlState.sneak) {
				bot.setControlState("sneak", true)
			}
		});
		bot.once("login", () => {
			botOnline[index - 1] = true;
			if (LOG) {
				appendLog("[JOIN]", username)
			}
			if (!on) {
				console.log(`${username} joined`)
			}
			delay = 100;
			if (PASSWORD) {
				bot.chat(`/login ${PASSWORD}`)
			}
		});

		function setPos(packet, doUpd = true) {
			if (!bot.entity) {
				return
			}
			const npos = `${Math.floor(bot.entity.position.x)} ${Math.floor(bot.entity.position.y)} ${Math.floor(bot.entity.position.z)}`;
			if (npos !== botPos[index - 1]) {
				botPos[index - 1] = npos;
				if (doUpd) {
					updateData()
				}
			}
		}
		bot.on("move", setPos);

		function setDim(packet) {
			const changeDim = dimension[index - 1] !== bot.game.dimension;
			setPos(packet, !changeDim);
			if (changeDim) {
				dimension[index - 1] = bot.game.dimension;
				if (!on) {
					console.log(username, "spawn at dim", dimension[index - 1])
				}
				updateWaypoints()
			}
		}
		bot.on("respawn", setDim);
		bot.on("spawn", setDim);
		if (LOG) {
			bot.on("chat", (username, message) => {
				if (botNames.includes(username)) {
					return
				}
				appendLog("[CHAT]", username, message.replaceAll("\n", "\\n"))
			})
		}

		function playerChange() {
			playerss[index - 1] = Object.fromEntries(Object.values(bot.players).filter(p => p.uuid && p.username).map(p => [p.uuid, p.username]));
			updatePlayers()
		}
		bot._client.on("player_info", playerChange);
		bot.on("playerJoined", playerChange);
		bot.on("playerLeft", playerChange);
		bot._client.on("tracked_waypoint", packet => {
			const waypoint = packet?.waypoint;
			if (waypoint?.hasUUID && waypoint.uuid && operations[packet.operation]) {
				delete waypointss[index - 1][waypoint.uuid];
				if (operations[packet.operation] === 1) {
					if (dataTypes[waypoint.type] === 3) {
						if (waypoint.data) {
							waypointss[index - 1][waypoint.uuid] = {
								type: waypoint.type,
								data: {
									azimuth: waypoint.data,
									position: {
										x: bot.entity.position.x,
										z: bot.entity.position.z
									}
								}
							}
						}
					} else if (dataTypes[waypoint.type]) {
						waypointss[index - 1][waypoint.uuid] = {
							type: waypoint.type,
							data: waypoint.data
						}
					}
				}
				updateWaypoints()
			}
		});

		function updatePlayers2(entity) {
			if (!entity || entity.type !== "player") {
				return
			}
			const newPositions = Object.values(bot.players).filter(player => player.entity && player.uuid).map(player => [player.uuid, `${Math.floor(player.entity.position.x)} ${Math.floor(player.entity.position.y)} ${Math.floor(player.entity.position.z)}`]);
			if (JSON.stringify(waypointss2[index - 1]) !== JSON.stringify(newPositions)) {
				waypointss2[index - 1] = newPositions;
				updateWaypoints()
			}
		}
		bot.on("entitySpawn", updatePlayers2);
		bot.on("entityMoved", updatePlayers2);
		bot.on("entityGone", updatePlayers2);
		bot.once("end", scheduleReconnect);
		bot.once("error", scheduleReconnect)
	}

	function scheduleReconnect() {
		if (timer) return;
		if (!on) {
			console.log(`${username} reconnecting in ${delay/1e3}s`)
		}
		if (LOG) {
			appendLog("[Reconnect]", username)
		}
		botOnline[index - 1] = false;
		timer = setTimeout(() => {
			timer = null;
			delay = Math.min(delay * 2, MAX_DELAY);
			connect()
		}, delay)
	}
	connect()
}
playerss = Array.from({
	length: CNT
}, () => ({}));
waypointss = Array.from({
	length: CNT
}, () => ({}));
waypointss2 = Array.from({
	length: CNT
}, () => []);
dimension = Array.from({
	length: CNT
}, () => "");
for (let i = 1; i <= CNT; i++) {
	createManagedBot(i)
}
