// ─── Data shapes ────────────────────────────────────────────────
/**
 * A runner, as the page hands it to init(): one row of the racecard.
 * @typedef {Object} Runner
 * @property {number|string} id
 * @property {number} number          saddle-cloth number
 * @property {string} name
 * @property {string} jockey
 * @property {string} trainer
 * @property {string} odds            fractional, e.g. "10/1"
 * @property {number} weight          forecast strength; a number after init()
 * @property {string} [silk]          jersey colour
 * @property {string} [silk2]         second silk colour
 * @property {string} [silk_pattern]  solid | hooped | striped | halved | quartered | starred
 * @property {string} [silk_url]      a real silks image, used when present
 * @property {number} [sr]            speed rating
 * @property {number} [stars]         0–5
 * @property {boolean} [is_fav]
 */

/**
 * What the page's boot script passes to init().
 * @typedef {Object} RaceData
 * @property {Runner[]} runners
 * @property {Runner|null} userPick   the viewer's own pick (matched by id)
 * @property {Runner|null} foxPick    Mr Fox's pick (matched by name)
 * @property {string} raceName
 * @property {string} raceDistance
 * @property {'sprint'|'mile'|'stayer'} raceBand
 */

/**
 * The race's result, read from #replayData (README → Payload contract).
 * @typedef {Object} ReplayData
 * @property {boolean} has_result
 * @property {Array<number|string>} result_order        runner ids, winner first
 * @property {Object<string, string>} beaten_distances  Racing API copy per runner id: "nk", "1 1/2"
 * @property {boolean} has_distances
 * @property {Object<string, number>} lengths_behind_winner
 */

/**
 * A runner in the race scene, built by buildHorseObjects().
 * @typedef {Object} Horse
 * @property {Runner} runner
 * @property {number} finalPos        finishing position, 0 = the winner
 * @property {number} finalLengths    lengths behind the winner at the line
 * @property {number} deficit         live lengths behind the leader
 * @property {number} travel          lengths covered
 * @property {number} worldX          world px from the stalls
 * @property {number} laneIdx         0 = far rail
 * @property {number} depth           lane scale: far rail smallest
 * @property {Array<{start: number, duration: number, lengths: number}>} surges
 * @property {number} duelFloor       how far ahead of the winner the duel may take him
 * @property {number} legPhase        gait phase in radians, advanced by distance
 * @property {number} [lineGap]       lengths behind the winner when the winner crossed
 * @property {number} [salute]        the Winning Moment salute, 0 → 1
 */

