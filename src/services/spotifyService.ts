const SpotifyWebApi = require('spotify-web-api-node')
const rp = require('request-promise-native')
const { URL } = require('url')

const spotifyScopes = ['playlist-modify-public', 'playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-private', 'user-read-recently-played']

export class SpotifyService {
  private spotifyApi;
  constructor (config) {
    this.spotifyApi = new SpotifyWebApi({
      clientId: config.spotifyAppId,
      clientSecret: config.spotifyAppSecret,
      redirectUri: config.externalUrl
    })
  }

  getBon (response) {
    // Calculates BON value for authentication cookie

    // This is a value that is received from the first authorization form and
    // it is needed to be calculated accordingly as it is a required Cookie.

    // The value is retrieved from the initial GET response after requesting
    // the authorization page with its headers. The page will then provide a
    // JSON content with the value needed as input for the algorithm.

    // The way it works is that it multiplies by 42 the last integer in the
    // list and it then appends four integers with a value of 1.

    // After this operation, it creates a string with every value separated by
    // "|" and it finally encodes it in base64.

    const initialBon = JSON.parse(response).BON
    const newArray = [...initialBon, 42 * initialBon[initialBon.length - 1], 1, 1, 1, 1]
    return Buffer.from(newArray.join('|')).toString('base64')
  }

  async authenticateAsUser (username, password) {
    const reqUrl = this.spotifyApi.createAuthorizeURL(spotifyScopes, 'test')
    const cookiejar = rp.jar()

    const initialRequest = await rp({url: reqUrl, jar: cookiejar, headers: {'Accept': 'application/json'}})

    const loginDeets = {
      remember: false,
      username: username,
      password: password,
      csrf_token: cookiejar.getCookieString('https://accounts.spotify.com').substring(11)
    }

    const bon = this.getBon(initialRequest)

    await rp({
      url: 'https://accounts.spotify.com/api/login',
      jar: cookiejar,
      form: loginDeets,
      method: 'POST',
      headers: {
        'Referer': 'https://accounts.spotify.com/nl/login?continue=' + encodeURIComponent(reqUrl),
        'Connection': 'keep-alive',
        'Accept': 'application/json, text/plain, */*',
        'Host': 'accounts.spotify.com',
        'Origin': 'https://accounts.spotify.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.111 Safari/537.36',
        'Cookie': `${cookiejar.getCookieString('https://accounts.spotify.com')}; fb_continue=${encodeURIComponent(reqUrl)}; __bon=${bon}; _ga=GA1.2.1004714942.1517806081; _gid=GA1.2.1087315215.1517806081; _gat=1;`
      }
    }).catch(e => console.log(e))

    const authorise = await rp({
      url: reqUrl,
      headers: {
        'Referer': reqUrl,
        'Connection': 'keep-alive',
        'Accept': 'application/json, text/plain, */*',
        'Host': 'accounts.spotify.com',
        'Origin': 'https://accounts.spotify.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.111 Safari/537.36',
        'Cookie': `${cookiejar.getCookieString('https://accounts.spotify.com')}; __bon=${bon}; _ga=GA1.2.1004714942.1517806081; _gid=GA1.2.1087315215.1517806081; _gat=1;`
      }
    }).catch(e => console.log(e))

    const code = new URL(JSON.parse(authorise).redirect).searchParams.get('code')
    const authorisation = await this.spotifyApi.authorizationCodeGrant(code)

    this.spotifyApi.setAccessToken(authorisation.body['access_token'])
    this.spotifyApi.setRefreshToken(authorisation.body['refresh_token'])
    this.scheduleCredentialsRefresh(authorisation.body)
  }

  scheduleCredentialsRefresh (authPayload) {
    setTimeout(this.refreshSpotifyCredentials.bind(this), parseInt(authPayload['expires_in']) * 500)
  }

  async refreshSpotifyCredentials () {
    const data = await this.spotifyApi.refreshAccessToken().catch((e) => {
      console.log('Could not refresh spotify credentials, retrying in 1 minute')
      console.log(e)
      setTimeout(this.refreshSpotifyCredentials.bind(this), 60000)
    })
    console.log('Refreshed spotify credentials')
    this.spotifyApi.setAccessToken(data.body['access_token'])
    this.scheduleCredentialsRefresh(data.body)
  }

  async getPlaylist (userId, playlistId) {
    return this.spotifyApi.getPlaylist(userId, playlistId)
  }

  async updatePlaylist (userId, playlistId, beats) {
    const topSpotifyBeats = beats
      .filter(beat => beat.uri.startsWith('spotify:'))
      .sort((a, b) => b.points - a.points)
      .slice(0, 100)
      .map(beat => beat.uri)

    const currentPlaylist = await this.spotifyApi.getPlaylist(userId, playlistId).catch(e => console.log(e))
    const currentBeats = currentPlaylist.body.tracks.items.map(data => data.track.uri).slice(0, 100)

    const toRemove = currentBeats.filter(beat => !topSpotifyBeats.includes(beat))
    const toAdd = topSpotifyBeats.filter(beat => !currentBeats.includes(beat))
    console.log('Updating Spotify playlist')
    console.log('Current', currentBeats)
    console.log('To remove', toRemove)
    console.log('To add', toAdd)

    if (toRemove.length) {
      await this.spotifyApi.removeTracksFromPlaylist(userId, playlistId, toRemove.map(uri => ({uri}))).catch(e => console.log(e))
    }
    if (toAdd.length) {
      await this.spotifyApi.addTracksToPlaylist(userId, playlistId, toAdd).catch(e => console.log(e))
    }

    const newPlaylist = await this.spotifyApi.getPlaylist(userId, playlistId).catch(e => console.log(e))
    const newBeats = newPlaylist.body.tracks.items.map(data => data.track.uri).slice(0, 100)

    this.sortPlaylist(userId, playlistId, newBeats, topSpotifyBeats)
  }

  async sortPlaylist (userId, playlistId, currentOrder, targetOrder, i?: number) {
    const targetIndex = i || 0
    if (targetIndex < currentOrder.length) {
      const uri = targetOrder[targetIndex]
      const currentIndex = currentOrder.indexOf(uri)
      if (currentIndex !== targetIndex) {
        console.log(`moving ${uri} from ${currentIndex} to ${targetIndex}`)
        await this.spotifyApi.reorderTracksInPlaylist(userId, playlistId, currentIndex, targetIndex)
        currentOrder.splice(targetIndex, 0, currentOrder.splice(currentIndex, 1)[0])
      }

      this.sortPlaylist(userId, playlistId, currentOrder, targetOrder, targetIndex + 1)
    }
  }
}
export default SpotifyService;
