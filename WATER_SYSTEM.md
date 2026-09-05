# Water system

`water.js` owns the water-domain behavior of the game.

- lake shape calculation
- water surface mesh creation
- water surface animation
- water-area detection
- water depth and surface height queries

`map.js` remains responsible for terrain generation. The terrain height function uses the same lake geometry so the lake depression and water surface stay aligned.

`player.js` can continue consuming `mapState.getWaterInfoAt()` for now, so this refactor does not change the player API.
