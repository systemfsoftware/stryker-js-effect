const refuseToLoad = (): never => {
  throw new Error('the config fixture refuses to load')
}

export default refuseToLoad()
