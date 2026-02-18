const { WAREHOUSES } = require('./constants');

class Ship {
  constructor(name) {
    this.name = name;
    this.crew = []; // Array of players, sorted by rank
    this.warehouses = {
      [WAREHOUSES.ENGLISH]: 0,
      [WAREHOUSES.FRENCH]: 0
    };
    this.successfulAttackLastNight = false;
  }

  addCrew(player) {
    this.crew.push(player);
    this.updateRanks();
  }

  removeCrew(playerId) {
    this.crew = this.crew.filter(p => p.id !== playerId);
    this.updateRanks();
  }

  updateRanks() {
    // Sort crew by their current rank if they have one, then preserve relative order
    // But actually, when joining, they get the next available rank.
    // If multiple people join at once, it's handled by the Game engine.
    this.crew.forEach((player, index) => {
      player.rank = index + 1;
    });
  }

  getTotalTreasures() {
    return this.warehouses[WAREHOUSES.ENGLISH] + this.warehouses[WAREHOUSES.FRENCH];
  }

  getCaptain() {
    return this.crew.find(p => p.rank === 1);
  }

  getFirstMate() {
    return this.crew.find(p => p.rank === 2);
  }

  getCabinBoy() {
    if (this.crew.length === 0) return null;
    return this.crew[this.crew.length - 1];
  }
}

module.exports = Ship;
