const storage = require('node-persist')

class VoteService {
  constructor (config) {
    this.beatsPoints = storage.initSync({ dir: config.beatsPointsLocation })
    this.votes = {}
    this.currentScore = 0
  }

  async startNewVote (uri) {
    if (this.currentUri) {
      await this.endVote()
    }
    this.currentUri = uri
    this.currentScore = 0
    this.votes = {}
  }

  async endVote () {
    if (this.currentUri) {
      await storage.setItem(this.currentUri, await this.getScore(this.currentUri))
    }
    this.currentUri = null
  }

  vote (userId, delta) {
    this.currentScore += delta - (this.votes[userId] || 0)
    this.votes[userId] = delta
  }

  getResults () {
    const results = []
    storage.forEach((k, v) => results.push({
      uri: k,
      points: (k === this.currentUri) ? (v || 0) + this.currentScore : (v || 0)
    }))

    return results.sort((a, b) => b.points - a.points)
  }

  async getScore (uri) {
    const storedScore = await storage.getItem(uri).then(parseInt).catch((e) => 0) || 0
    const score = (uri === this.currentUri) ? storedScore + this.currentScore : storedScore
    return score
  }
}

module.exports = VoteService
