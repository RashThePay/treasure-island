class Player {
  constructor(id, name, team) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.location = null;
    this.rank = 0;
    this.action = null;
    this.vote = null;
    this.actionData = null; // Store targets, warehouse choices, etc.
    this.actionTime = 0;
    this.hasBeenExiled = false; // To track if exiled in current or previous round
    this.exiledRound = -1;
  }

  isCaptain() {
    return this.rank === 1 && (this.location === 'FLYING_DUTCHMAN' || this.location === 'JOLLY_ROGER');
  }

  isFirstMate(crewCount) {
    if (crewCount === 1) return false;
    return this.rank === 2;
  }

  isCabinBoy(crewCount) {
    if (crewCount === 0) return false;
    return this.rank === crewCount;
  }

  isGovernor() {
    return this.rank === 1 && this.location === 'ISLAND';
  }
}

module.exports = Player;
