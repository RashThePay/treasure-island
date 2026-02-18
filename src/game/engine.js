const { TEAMS, LOCATIONS, WAREHOUSES, PHASES, ACTIONS, VOTES } = require('./constants');
const Player = require('./player');
const Ship = require('./ship');
const Island = require('./island');

class Game {
  constructor(chatId) {
    this.chatId = chatId;
    this.players = new Map(); // Map of playerId -> Player object
    this.ships = {
      [LOCATIONS.FLYING_DUTCHMAN]: new Ship('Flying Dutchman'),
      [LOCATIONS.JOLLY_ROGER]: new Ship('Jolly Roger')
    };
    this.island = new Island();
    this.spanishShipTreasures = 4;
    this.round = 0;
    this.phase = PHASES.LOBBY;
    this.fogMode = false;
    this.logs = [];
    this.mutinyAcceptedByCaptain = new Set(); // Players who can't return to ship next round
  }

  addPlayer(id, name) {
    if (this.players.size >= 10) return false;
    if (this.players.has(id)) return false;
    this.players.set(id, new Player(id, name, null));
    return true;
  }

  startGame(fogMode = false) {
    if (this.players.size < 4) return false;
    this.fogMode = fogMode;
    this.assignRoles();
    this.assignShips();
    this.phase = PHASES.PRE_GAME;
    this.round = 1;
    return true;
  }

  assignRoles() {
    const playerIds = Array.from(this.players.keys());
    const count = playerIds.length;
    let roles = [];

    const isEven = count % 2 === 0;
    let englishCount, frenchCount, specialRoles = [];

    if (isEven) {
      // 50% chance for 0 special, 50% for both Dutch and Spanish
      if (Math.random() < 0.5) {
        englishCount = count / 2;
        frenchCount = count / 2;
      } else {
        englishCount = (count - 2) / 2;
        frenchCount = (count - 2) / 2;
        specialRoles = [TEAMS.DUTCH, TEAMS.SPANISH];
      }
    } else {
      // Odd: 1 special (either Dutch or Spanish)
      englishCount = (count - 1) / 2;
      frenchCount = (count - 1) / 2;
      specialRoles = [Math.random() < 0.5 ? TEAMS.DUTCH : TEAMS.SPANISH];
    }

    for (let i = 0; i < englishCount; i++) roles.push(TEAMS.ENGLISH);
    for (let i = 0; i < frenchCount; i++) roles.push(TEAMS.FRENCH);
    roles = roles.concat(specialRoles);

    // Shuffle roles
    roles.sort(() => Math.random() - 0.5);

    playerIds.forEach((id, index) => {
      this.players.get(id).team = roles[index];
    });
  }

  assignShips() {
    const playerIds = Array.from(this.players.keys());
    playerIds.sort(() => Math.random() - 0.5);

    const half = Math.ceil(playerIds.length / 2);
    playerIds.forEach((id, index) => {
      const player = this.players.get(id);
      if (index < half) {
        player.location = LOCATIONS.FLYING_DUTCHMAN;
        this.ships[LOCATIONS.FLYING_DUTCHMAN].addCrew(player);
      } else {
        player.location = LOCATIONS.JOLLY_ROGER;
        this.ships[LOCATIONS.JOLLY_ROGER].addCrew(player);
      }
    });
  }

  setInitialWarehouse(playerId, warehouse) {
    const player = this.players.get(playerId);
    if (!player || !player.isCaptain()) return null;

    const ship = this.ships[player.location];
    ship.warehouses[warehouse] = 1;

    // Check if both captains have set their initial warehouse
    const bothSet = Object.values(this.ships).every(s => s.getTotalTreasures() === 1);
    if (bothSet) {
      this.phase = PHASES.DAY;
    }
    return player;
  }

  submitAction(playerId, action, actionData = null) {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.action = action;
    player.actionData = actionData;
    player.actionTime = Date.now();
    return true;
  }

  submitVote(playerId, vote) {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.vote = vote;
    return true;
  }

  allActionsSubmitted() {
    return Array.from(this.players.values()).every(p => p.action !== null);
  }

  allVotesSubmitted() {
    // Only those who CAN vote must submit
    const expectedVoters = this.getExpectedVoters();
    return expectedVoters.every(p => p.vote !== null);
  }

  getExpectedVoters() {
    const voters = [];
    const actions = Array.from(this.players.values()).map(p => ({ p, a: p.action }));

    // Mutiny voters
    const mutinies = actions.filter(x => x.a === ACTIONS.MUTINY);
    mutinies.forEach(({ p }) => {
      const ship = this.ships[p.location];
      if (ship.crew.length >= 3) {
        ship.crew.forEach(member => {
          if (member.rank !== 1) voters.push(member);
        });
      }
    });

    // Attack voters
    const attacks = actions.filter(x => x.a === ACTIONS.ATTACK);
    attacks.forEach(({ p }) => {
      const ship = this.ships[p.location];
      if (ship.crew.length >= 2) {
        ship.crew.forEach(member => voters.push(member));
      }
    });

    // Conflict voters
    const conflicts = actions.filter(x => x.a === ACTIONS.CONFLICT);
    if (conflicts.length > 0) {
      // Only one conflict per round, take the first one
      this.island.residents.forEach(member => voters.push(member));
    }

    // De-duplicate voters
    return Array.from(new Set(voters));
  }

  resolveDay() {
    const players = Array.from(this.players.values());
    const roundLogs = [];

    // 1. Move
    const movers = players.filter(p => p.action === ACTIONS.MOVE).sort((a, b) => {
      // Priority: higher rank first, then earlier submission
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.actionTime - b.actionTime;
    });

    movers.forEach(p => {
      const oldLocation = p.location;
      const target = p.actionData.target;

      // Check exile restriction
      if (target !== LOCATIONS.ISLAND && p.hasBeenExiled && (this.round === p.exiledRound || this.round === p.exiledRound + 1)) {
        roundLogs.push(`${p.name} به دلیل اخراج شدن نمی‌تواند به کشتی بازگردد.`);
        return;
      }

      this.movePlayer(p, target);
      roundLogs.push(`${p.name} از ${this.getLocationName(oldLocation)} به ${this.getLocationName(target)} رفت.`);
    });

    // Reset mutinyAcceptedByCaptain set at start of each resolution?
    // Actually the rule says: if Captain leaves voluntarily during mutiny, they can't return next round.
    const mutinyTargets = players.filter(p => p.action === ACTIONS.MUTINY).map(p => p.location);
    movers.forEach(p => {
       if (p.rank === 1 && mutinyTargets.includes(p.location)) {
           // This check should probably happen BEFORE the move, but the move is already done.
           // Actually, if they were rank 1 at the start of the round and moved.
           // We'll handle this in the movePlayer logic if needed or here.
       }
    });

    // Check for "Check Warehouse" (Fog mode) - resolved instantly or after move?
    // Rules say moves are first.
    if (this.fogMode) {
      players.filter(p => p.action === ACTIONS.CHECK_WAREHOUSE).forEach(p => {
        // This will be handled in the bot layer to send DM
      });
    }

    this.phase = PHASES.NIGHT;
    return roundLogs;
  }

  movePlayer(player, target) {
    // Remove from old location
    if (player.location === LOCATIONS.ISLAND) {
      this.island.removeResident(player.id);
    } else {
      this.ships[player.location].removeCrew(player.id);
    }

    // Special case: Captain leaves during mutiny
    const isCaptainDuringMutiny = player.rank === 1 &&
                                  player.location !== LOCATIONS.ISLAND &&
                                  Array.from(this.players.values()).some(p => p.action === ACTIONS.MUTINY && p.location === player.location);
    if (isCaptainDuringMutiny && target === LOCATIONS.ISLAND) {
       player.hasBeenExiled = true;
       player.exiledRound = this.round;
    }

    // Add to new location
    player.location = target;
    if (target === LOCATIONS.ISLAND) {
      this.island.addResident(player);
    } else {
      this.ships[target].addCrew(player);
    }
  }

  resolveNight() {
    const roundLogs = [];
    const players = Array.from(this.players.values());

    // 2. Treasure Move (Cabin Boy)
    players.filter(p => p.action === ACTIONS.TREASURE_MOVE).forEach(p => {
      const ship = this.ships[p.location];
      if (ship.successfulAttackLastNight) {
        roundLogs.push(`${p.name} به دلیل حمله موفق دیشب، نتوانست گنج را جابه‌جا کند.`);
        return;
      }
      const { from, to } = p.actionData;
      if (ship.warehouses[from] > 0) {
        ship.warehouses[from]--;
        ship.warehouses[to]++;
        if (this.fogMode) {
            roundLogs.push(`${p.name} یک گنج را در ${ship.name} جابه‌جا کرد. (جزئیات مخفی)`);
        } else {
            roundLogs.push(`${p.name} یک گنج را از انبار ${this.getWarehouseName(from)} به ${this.getWarehouseName(to)} در ${ship.name} جابه‌جا کرد.`);
        }
      }
    });

    // 3. Mutiny
    players.filter(p => p.action === ACTIONS.MUTINY).forEach(p => {
      const ship = this.ships[p.location];
      if (ship.crew.length < 3) {
        roundLogs.push(`شورش در ${ship.name} به دلیل کمبود خدمه لغو شد.`);
        return;
      }
      const voters = ship.crew.filter(m => m.rank !== 1);
      const supports = voters.filter(v => v.vote === VOTES.SUPPORT).length;
      const opposes = voters.filter(v => v.vote === VOTES.OPPOSE).length;

      roundLogs.push(`نتیجه شورش در ${ship.name}: ${supports} موافق، ${opposes} مخالف.`);
      if (supports > opposes) {
        const captain = ship.getCaptain();
        roundLogs.push(`شورش پیروز شد! ${captain.name} به جزیره اخراج شد.`);
        this.movePlayer(captain, LOCATIONS.ISLAND);
        captain.hasBeenExiled = true;
        captain.exiledRound = this.round;
      }
    });

    // 4. Attack / Exile
    // Attack first? Rules say "Attack/Exile (Captain)". Usually Captain does one or the other.
    players.filter(p => p.action === ACTIONS.ATTACK || p.action === ACTIONS.EXILE).forEach(p => {
       // Check if p is still captain (might have been mutinied)
       if (!p.isCaptain()) return;

       if (p.action === ACTIONS.ATTACK) {
         this.resolveAttack(p, roundLogs);
       } else if (p.action === ACTIONS.EXILE) {
         const targetId = p.actionData.targetId;
         const target = this.players.get(targetId);
         if (target && target.location === p.location && target.id !== p.id) {
           roundLogs.push(`${p.name}، ${target.name} را به جزیره اخراج کرد.`);
           this.movePlayer(target, LOCATIONS.ISLAND);
           target.hasBeenExiled = true;
           target.exiledRound = this.round;
         }
       }
    });

    // 5. Conflict
    const conflictAction = players.find(p => p.action === ACTIONS.CONFLICT);
    if (conflictAction) {
      this.resolveConflict(roundLogs);
    }

    // 6. Call Fleet
    const callFleetAction = players.find(p => p.action === ACTIONS.CALL_FLEET);
    if (callFleetAction && this.round >= 6) {
      const governor = this.island.getGovernor();
      if (governor && governor.id === callFleetAction.id) {
        roundLogs.push(`حاکم جزیره ناوگان اسپانیا را فراخواند!`);
        this.phase = PHASES.GAME_OVER;
      }
    } else if (this.round >= 10) {
      roundLogs.push(`راند ۱۰ به پایان رسید و ناوگان اسپانیا از راه رسید.`);
      this.phase = PHASES.GAME_OVER;
    }

    if (this.phase !== PHASES.GAME_OVER) {
      this.round++;
      this.phase = PHASES.DAY;
      // Reset daily state
      players.forEach(p => {
        p.action = null;
        p.actionData = null;
        p.vote = null;
      });
      // Update successful attack flag for next round's cabin boy check
      Object.values(this.ships).forEach(ship => {
        const captain = ship.getCaptain();
        if (!captain || captain.action !== ACTIONS.ATTACK) {
          ship.successfulAttackLastNight = false;
        }
      });
    }

    return roundLogs;
  }

  resolveAttack(captain, logs) {
    const ship = this.ships[captain.location];
    if (ship.crew.length < 2) {
      logs.push(`حمله در ${ship.name} به دلیل تنهایی ناخدا لغو شد.`);
      return;
    }

    const raids = ship.crew.filter(m => m.vote === VOTES.RAID).length;
    const fires = ship.crew.filter(m => m.vote === VOTES.FIRE).length;
    const extinguishes = ship.crew.filter(m => m.vote === VOTES.EXTINGUISH).length;

    logs.push(`نتیجه حمله در ${ship.name}: ${raids} یورش، ${fires} آتش، ${extinguishes} خاموش.`);

    if (raids === 1 && extinguishes <= 1 && fires >= 1) {
      ship.successfulAttackLastNight = true;
      const targetWarehouse = captain.actionData.warehouse;

      if (this.spanishShipTreasures > 0) {
        this.spanishShipTreasures--;
        ship.warehouses[targetWarehouse]++;
        const whName = this.fogMode ? 'نامشخص' : this.getWarehouseName(targetWarehouse);
        logs.push(`حمله موفقیت‌آمیز بود! یک گنج از کشتی اسپانیایی به انبار ${whName} منتقل شد.`);
      } else {
        // Attack the other pirate ship
        const otherShipLocation = captain.location === LOCATIONS.FLYING_DUTCHMAN ? LOCATIONS.JOLLY_ROGER : LOCATIONS.FLYING_DUTCHMAN;
        const otherShip = this.ships[otherShipLocation];
        const opponentWarehouse = targetWarehouse === WAREHOUSES.ENGLISH ? WAREHOUSES.FRENCH : WAREHOUSES.ENGLISH;

        if (otherShip.warehouses[opponentWarehouse] > 0) {
          otherShip.warehouses[opponentWarehouse]--;
          ship.warehouses[targetWarehouse]++;
          if (this.fogMode) {
              logs.push(`حمله موفقیت‌آمیز بود! یک گنج از کشتی دیگر به انبار شما منتقل شد. (انبارها مخفی)`);
          } else {
              logs.push(`حمله موفقیت‌آمیز بود! یک گنج از انبار ${this.getWarehouseName(opponentWarehouse)} کشتی دیگر به انبار ${this.getWarehouseName(targetWarehouse)} شما منتقل شد.`);
          }
        } else {
          logs.push(`حمله موفقیت‌آمیز بود، اما انبار هدف در کشتی دیگر خالی بود!`);
        }
      }
    } else {
      ship.successfulAttackLastNight = false;
      logs.push(`حمله در ${ship.name} شکست خورد.`);
    }
  }

  resolveConflict(logs) {
    const residents = this.island.residents;
    if (residents.length === 0) return;

    const englishVotes = residents.filter(r => r.vote === VOTES.VOTE_ENGLISH).length;
    const frenchVotes = residents.filter(r => r.vote === VOTES.VOTE_FRENCH).length;

    logs.push(`نتیجه منازعه جزیره: انگلیسی ${englishVotes}، فرانسوی ${frenchVotes}.`);

    const governor = this.island.getGovernor();
    let governorLost = false;

    if (englishVotes > frenchVotes) {
      this.island.treasures[WAREHOUSES.ENGLISH] += this.island.treasures[WAREHOUSES.FRENCH];
      this.island.treasures[WAREHOUSES.FRENCH] = 0;
      logs.push(`انگلیسی‌ها پیروز شدند و تمام گنج‌های جزیره را گرفتند.`);
      if (governor && governor.vote !== VOTES.VOTE_ENGLISH) governorLost = true;
    } else if (frenchVotes > englishVotes) {
      this.island.treasures[WAREHOUSES.FRENCH] += this.island.treasures[WAREHOUSES.ENGLISH];
      this.island.treasures[WAREHOUSES.ENGLISH] = 0;
      logs.push(`فرانسوی‌ها پیروز شدند و تمام گنج‌های جزیره را گرفتند.`);
      if (governor && governor.vote !== VOTES.VOTE_FRENCH) governorLost = true;
    } else {
      const total = this.island.treasures[WAREHOUSES.ENGLISH] + this.island.treasures[WAREHOUSES.FRENCH];
      this.island.treasures[WAREHOUSES.ENGLISH] = Math.floor(total / 2);
      this.island.treasures[WAREHOUSES.FRENCH] = Math.ceil(total / 2);
      logs.push(`نتیجه مساوی شد و گنج‌ها تقسیم شدند.`);
      governorLost = true; // Tie also removes governor if not fog mode or special roles
    }

    // Special roles and Fog mode governor rules
    if (governor) {
      const isSpecial = governor.team === TEAMS.DUTCH || governor.team === TEAMS.SPANISH;
      if (!this.fogMode && isSpecial) {
        governorLost = true; // Dutch/Spanish always lose governor after conflict in normal mode
      }

      if (governorLost) {
        logs.push(`${governor.name} حاکمیت جزیره را از دست داد.`);
        this.island.removeResident(governor.id);
        this.island.addResident(governor); // Add to end of rank
      }
    }
  }

  getScores() {
    const scores = {
      [TEAMS.ENGLISH]: this.island.treasures[WAREHOUSES.ENGLISH],
      [TEAMS.FRENCH]: this.island.treasures[WAREHOUSES.FRENCH],
    };

    Object.values(this.ships).forEach(ship => {
      scores[TEAMS.ENGLISH] += ship.warehouses[WAREHOUSES.ENGLISH];
      scores[TEAMS.FRENCH] += ship.warehouses[WAREHOUSES.FRENCH];
    });

    return scores;
  }

  getWinners() {
    const scores = this.getScores();
    const governor = this.island.getGovernor();
    const winners = [];

    let dutchWinner = null;
    let spanishWinner = null;

    // Check Dutch/Spanish tie-breaker (Condition 2)
    if (scores[TEAMS.ENGLISH] === scores[TEAMS.FRENCH] && governor) {
      if (governor.team === TEAMS.DUTCH) dutchWinner = governor;
      if (governor.team === TEAMS.SPANISH) spanishWinner = governor;
    }

    // Check Dutch Captain (Condition 1)
    this.players.forEach(p => {
      if (p.team === TEAMS.DUTCH && p.isCaptain()) {
        const ship = this.ships[p.location];
        const otherShip = this.ships[p.location === LOCATIONS.FLYING_DUTCHMAN ? LOCATIONS.JOLLY_ROGER : LOCATIONS.FLYING_DUTCHMAN];
        if (ship.getTotalTreasures() > otherShip.getTotalTreasures()) {
          dutchWinner = p;
        }
      }
    });

    // Check Spanish Ship (Condition 1)
    if (this.spanishShipTreasures >= 2) {
      const spanishPlayer = Array.from(this.players.values()).find(p => p.team === TEAMS.SPANISH);
      if (spanishPlayer) spanishWinner = spanishPlayer;
    }

    if (dutchWinner) {
      winners.push(dutchWinner);
      // Dutch win cancels English/French win
    } else if (spanishWinner && scores[TEAMS.ENGLISH] === scores[TEAMS.FRENCH] && governor && governor.team === TEAMS.SPANISH) {
      winners.push(spanishWinner);
      // Spanish Governor in tie wins "alone"
    } else {
      // Standard English/French win
      let winnerTeam = null;
      if (scores[TEAMS.ENGLISH] > scores[TEAMS.FRENCH]) {
        winnerTeam = TEAMS.ENGLISH;
      } else if (scores[TEAMS.FRENCH] > scores[TEAMS.ENGLISH]) {
        winnerTeam = TEAMS.FRENCH;
      } else if (governor) {
        winnerTeam = governor.team;
      }

      if (winnerTeam === TEAMS.ENGLISH || winnerTeam === TEAMS.FRENCH) {
        this.players.forEach(p => {
          if (p.team === winnerTeam) winners.push(p);
        });
      }
    }

    // Spanish condition 1 win is independent (can happen alongside others)
    if (this.spanishShipTreasures >= 2) {
      const spanishPlayer = Array.from(this.players.values()).find(p => p.team === TEAMS.SPANISH);
      if (spanishPlayer && !winners.includes(spanishPlayer)) {
        winners.push(spanishPlayer);
      }
    }

    return winners;
  }

  getLocationName(loc) {
    if (loc === LOCATIONS.FLYING_DUTCHMAN) return 'فلاینگ داچمن';
    if (loc === LOCATIONS.JOLLY_ROGER) return 'جالی راجر';
    if (loc === LOCATIONS.ISLAND) return 'جزیره';
    return loc;
  }

  getWarehouseName(w) {
    return w === WAREHOUSES.ENGLISH ? 'انگلیسی' : 'فرانسوی';
  }

  getGameStateSummary() {
    let summary = `📍 *راند ${this.round} - فاز ${this.phase === PHASES.DAY ? 'روز' : 'شب'}*\n\n`;

    summary += `🚢 *فلاینگ داچمن:*\n`;
    if (this.ships[LOCATIONS.FLYING_DUTCHMAN].crew.length === 0) summary += `  (بدون خدمه)\n`;
    this.ships[LOCATIONS.FLYING_DUTCHMAN].crew.forEach(p => {
      summary += `  ${p.rank}. ${p.name} ${this.getRoleIcon(p)}\n`;
    });
    summary += `  💰 گنج‌ها: ${this.getShipTreasureSummary(LOCATIONS.FLYING_DUTCHMAN)}\n\n`;

    summary += `🏴‍☠️ *جالی راجر:*\n`;
    if (this.ships[LOCATIONS.JOLLY_ROGER].crew.length === 0) summary += `  (بدون خدمه)\n`;
    this.ships[LOCATIONS.JOLLY_ROGER].crew.forEach(p => {
      summary += `  ${p.rank}. ${p.name} ${this.getRoleIcon(p)}\n`;
    });
    summary += `  💰 گنج‌ها: ${this.getShipTreasureSummary(LOCATIONS.JOLLY_ROGER)}\n\n`;

    summary += `🏝 *جزیره:*\n`;
    if (this.island.residents.length === 0) summary += `  (بدون ساکن)\n`;
    this.island.residents.forEach(p => {
      summary += `  ${p.rank}. ${p.name} ${p.rank === 1 ? '👑' : ''}\n`;
    });
    summary += `  💰 گنج‌ها: انگلیس ${this.island.treasures.ENGLISH} | فرانسه ${this.island.treasures.FRENCH}\n\n`;

    summary += `🇪🇸 *کشتی اسپانیایی:* ${this.spanishShipTreasures} گنج باقی‌مانده\n`;

    return summary;
  }

  getRoleIcon(p) {
    if (p.rank === 1) return '⚓️'; // Captain
    if (p.rank === 2) return '🗡'; // First Mate
    const ship = this.ships[p.location];
    if (ship && p.rank === ship.crew.length) return '📦'; // Cabin Boy
    return '';
  }

  getShipTreasureSummary(loc) {
    const ship = this.ships[loc];
    if (this.fogMode) {
      return `${ship.getTotalTreasures()} (نامشخص)`;
    }
    return `🏴‍☠️ ${ship.warehouses.ENGLISH} | 🇫🇷 ${ship.warehouses.FRENCH}`;
  }
}

module.exports = Game;
