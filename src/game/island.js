class Island {
  constructor() {
    this.residents = [];
    this.treasures = {
      ENGLISH: 1,
      FRENCH: 1
    };
  }

  addResident(player) {
    this.residents.push(player);
    this.updateRanks();
  }

  removeResident(playerId) {
    this.residents = this.residents.filter(p => p.id !== playerId);
    this.updateRanks();
  }

  updateRanks() {
    this.residents.forEach((player, index) => {
      player.rank = index + 1;
    });
  }

  getGovernor() {
    return this.residents.find(p => p.rank === 1);
  }
}

module.exports = Island;
