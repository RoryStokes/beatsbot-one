const maymays = [
  {
    uri: 'local:track:gud%20song/02.%20Bring%20Me%20To%20Life.mp3',
    triggers: [['wake'], ['up']]
  },
  {
    uri: 'local:track:sound%20bytes/Song%20bits/I_Will_Always_Love_You_Whitney.mp3',
    triggers: [['and i']]
  },
  {
    uri: 'local:track:sound%20bytes/Memeliners/shaboy.mp3',
    triggers: [['shaboi', 'shaboy']]
  },
  {
    uri: 'local:track:sound%20bytes/Welcome%20to%20EB%20Games..mp3',
    triggers: [['guys'], ['woah', 'hey']]
  },
  {
    uri: 'local:track:sound%20bytes/Memeliners/check.mp3',
    triggers: [['tier'], ['check', 'list']]
  },
  {
    uri: 'local:track:sound%20bytes/crond6/Sick%20Joke.mp3',
    triggers: [['sick joke']]
  },
  {
    uri: 'local:track:sound%20bytes/memeliners/oh%20god%20i%20love%20memes.mp3',
    triggers: [['meme'], ['like', 'love', 'feel']]
  },
  {
    uri: 'local:track:Sound%20Bytes/Eternal%20suffering/How%20to%20properly%20clean%20your%20gaming%20computer.mp3',
    triggers: [['computer'], ['clean', 'dusty', 'filthy']]
  },
  {
    uri: 'local:track:Meme/CHEEKY%20NANDOS%20-%20PERI%20BOYZ%20%28Vuj-Mim-Klayze%29%20%284K%29.mp3',
    triggers: [['oi oi']]
  }
]

/* HandleMessage should return an object with any of the following properties
{
  reply: "String to reply with",
  play: "uri of song to play",
  vote: <integer indicating direction of vote>
}
 */
export const handleMessage = function (cmd: string, args: string) {
  const normalised = args.toLowerCase()

  console.log(cmd)

  if (cmd) {
    if (cmd.startsWith('up')) {
      return { vote: 1 }
    } else if (cmd.startsWith('down')) {
      return { vote: -1 }
    }
  } else if (normalised.startsWith('what a') && normalised.indexOf('b') && normalised.indexOf('t')) {
    return { vote: 1 }
  } else if (normalised.startsWith('shelve ya dingbats beeto')) {
    return { reply: 'oi nah fuk off m8 im good' }
  } else if (normalised === 'updoot') {
    return { vote: 1 }
  } else if (normalised === 'downboat') {
    return { vote: -1 }
  } else {
    for (const mayme of maymays) {
      const match = mayme.triggers.every(words => words.some((word) => normalised.includes(word)))

      if (match) {
        return { play: mayme.uri, bang: normalised.includes('!') }
      }
    }
  }
}

