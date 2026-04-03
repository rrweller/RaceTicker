local M = {}
local lapTiming = require('/lua/ge/extensions/raceTickerLapTiming')

local uiConfigPath = "/settings/raceTicker.json"
local carColorsCsvPath = "/settings/raceTicker_car_colors.csv"
local uiScaleOptions = {0.5, 2 / 3, 0.75, 1, 1.25, 1.5}
local lineErrorToleranceOptions = {2, 3, 4, 5, 6, 7, 8}
local minLineErrorTolerance = 2
local maxLineErrorTolerance = 8
local defaultLineErrorTolerance = 5
local defaultShowLapsDown = true
local defaultRelativeGap = false
local defaultShowCarNumberBoxes = true
local defaultUseCsvCarColors = true
local defaultEnableRaceSplits = true
local defaultTimingMode = "absolute"
local defaultShowCheckpointDebug = false

local scriptStateByVehId = {}
local fuelByVehId = {}
local speedByVehId = {}
local lastSeenMsByVehId = {}
local uiConfigCache = nil
local carColorsCache = {}

local activeUntilMs = 0
local lastPollMs = 0
local pollIntervalMs = 200
local staleAfterMs = 1500
local lastCarColorsRefreshMs = -1
local carColorsRefreshIntervalMs = 2000

local function nowMs()
  return Engine.Platform.getSystemTimeMS()
end

local function copyTable(value)
  if type(value) ~= "table" then
    return value
  end

  local copy = {}
  for key, entry in pairs(value) do
    copy[key] = copyTable(entry)
  end

  return copy
end

local function normalizeVehId(vehId)
  local numericVehId = tonumber(vehId)
  if not numericVehId then
    return nil
  end

  return math.floor(numericVehId)
end

local function sanitizeSeriesText(value)
  local text = tostring(value or "")
  text = text:gsub("%s+", " ")
  text = text:match("^%s*(.-)%s*$") or ""
  if text == "" then
    return "RACE"
  end

  if #text > 24 then
    text = text:sub(1, 24)
  end

  return text
end

local function sanitizeTimingMode(value)
  local mode = tostring(value or defaultTimingMode)
  if mode ~= "absolute" and mode ~= "relative" and mode ~= "bestLap" and mode ~= "averageLap" then
    return defaultTimingMode
  end

  return mode
end

local function normalizeUiScale(value)
  local numericValue = tonumber(value) or 1
  local bestValue = uiScaleOptions[1]
  local bestDistance = math.abs(numericValue - bestValue)

  for index = 2, #uiScaleOptions do
    local optionValue = uiScaleOptions[index]
    local distance = math.abs(numericValue - optionValue)
    if distance < bestDistance then
      bestValue = optionValue
      bestDistance = distance
    end
  end

  return bestValue
end

local function normalizeLineErrorTolerance(value)
  local numericValue = tonumber(value) or defaultLineErrorTolerance
  local bestValue = lineErrorToleranceOptions[1]
  local bestDistance = math.abs(numericValue - bestValue)

  for index = 2, #lineErrorToleranceOptions do
    local optionValue = lineErrorToleranceOptions[index]
    local distance = math.abs(numericValue - optionValue)
    if distance < bestDistance then
      bestValue = optionValue
      bestDistance = distance
    end
  end

  return math.max(minLineErrorTolerance, math.min(bestValue, maxLineErrorTolerance))
end

local function sanitizeUiConfig(config)
  local data = type(config) == "table" and config or {}
  local timingMode = sanitizeTimingMode(data.timingMode or ((data.relativeGap and true or false) and "relative" or "absolute"))
  local enableRaceSplits = true

  return {
    showFuel = data.showFuel and true or false,
    showLapsDown = data.showLapsDown == nil and defaultShowLapsDown or (data.showLapsDown and true or false),
    relativeGap = timingMode == "relative" or (timingMode ~= "absolute" and (data.relativeGap == nil and defaultRelativeGap or (data.relativeGap and true or false))),
    showCarNumberBoxes = data.showCarNumberBoxes == nil and defaultShowCarNumberBoxes or (data.showCarNumberBoxes and true or false),
    useCsvCarColors = data.useCsvCarColors == nil and defaultUseCsvCarColors or (data.useCsvCarColors and true or false),
    uiScale = normalizeUiScale(data.uiScale),
    seriesText = sanitizeSeriesText(data.seriesText),
    lineErrorTolerance = normalizeLineErrorTolerance(data.lineErrorTolerance),
    manualLapCount = math.max(math.floor(tonumber(data.manualLapCount) or 0), 0),
    enableRaceSplits = enableRaceSplits,
    timingMode = timingMode,
    showCheckpointDebug = data.showCheckpointDebug == nil and defaultShowCheckpointDebug or (data.showCheckpointDebug and true or false)
  }
end

local function trim(value)
  return tostring(value or ""):match("^%s*(.-)%s*$") or ""
end

local function normalizeCarNumberKey(value)
  local numericValue = tonumber(value)
  if not numericValue then
    return nil
  end

  numericValue = math.floor(numericValue)
  if numericValue < 0 then
    return nil
  end

  return tostring(numericValue)
end

local function normalizeHexColor(value)
  local hex = trim(value)
  if hex == "" then
    return nil
  end

  if hex:sub(1, 1) == "#" then
    hex = hex:sub(2)
  end

  if hex:match("^[%x][%x][%x]$") then
    local h1, h2, h3 = hex:sub(1, 1), hex:sub(2, 2), hex:sub(3, 3)
    hex = h1 .. h1 .. h2 .. h2 .. h3 .. h3
  end

  if not hex:match("^[%x][%x][%x][%x][%x][%x]$") then
    return nil
  end

  return "#" .. string.upper(hex)
end

local function parseCarColorsCsv(content)
  local result = {}
  if type(content) ~= "string" then
    return result
  end

  local lineIndex = 0
  for rawLine in content:gmatch("[^\r\n]+") do
    lineIndex = lineIndex + 1
    local line = rawLine
    if lineIndex == 1 then
      line = line:gsub("^\239\187\191", "")
    end

    line = trim(line)
    if line ~= "" then
      local numberRaw, colorRaw = line:match("^([^,]+),(.+)$")
      if numberRaw and colorRaw then
        local numberKey = normalizeCarNumberKey(numberRaw)
        local hexColor = normalizeHexColor(colorRaw)
        if numberKey and hexColor then
          result[numberKey] = hexColor
        end
      end
    end
  end

  return result
end

local function ensureCarColorsCsvExists()
  if FS and FS.fileExists and FS:fileExists(carColorsCsvPath) then
    return
  end

  writeFile(carColorsCsvPath, "carnumber,color\n")
end

local function refreshCarColors(force)
  local currentTimeMs = nowMs()
  if not force and lastCarColorsRefreshMs >= 0 and (currentTimeMs - lastCarColorsRefreshMs) < carColorsRefreshIntervalMs then
    return
  end

  lastCarColorsRefreshMs = currentTimeMs
  ensureCarColorsCsvExists()
  carColorsCache = parseCarColorsCsv(readFile(carColorsCsvPath))
end

local function getUiConfig()
  if uiConfigCache == nil then
    uiConfigCache = sanitizeUiConfig(jsonReadFile(uiConfigPath) or {})
  end

  return copyTable(uiConfigCache)
end

local function saveUiConfig(config)
  uiConfigCache = sanitizeUiConfig(config)
  jsonWriteFile(uiConfigPath, uiConfigCache, true)
  return copyTable(uiConfigCache)
end

local function shouldTrackLapTiming(config)
  return true
end

local function touchVeh(vehId)
  local normalizedVehId = normalizeVehId(vehId)
  if not normalizedVehId then
    return nil
  end

  lastSeenMsByVehId[normalizedVehId] = nowMs()
  return normalizedVehId
end

local function pruneStale()
  local currentTimeMs = nowMs()
  for vehId, seenMs in pairs(lastSeenMsByVehId) do
    if currentTimeMs - (tonumber(seenMs) or 0) > staleAfterMs then
      lastSeenMsByVehId[vehId] = nil
      scriptStateByVehId[vehId] = nil
      fuelByVehId[vehId] = nil
      speedByVehId[vehId] = nil
    end
  end
end

local function pollVehicles()
  if not be or not be.queueAllObjectLua then
    return
  end

  be:queueAllObjectLua('obj:queueGameEngineLua("extensions.raceTickerScriptAI.onVehicleScriptState("..tostring(objectId)..","..serialize(ai.scriptState())..")")')
  be:queueAllObjectLua('obj:queueGameEngineLua("extensions.raceTickerScriptAI.onVehicleFuel("..tostring(objectId)..","..serialize(electrics.values.fuel)..")")')
  be:queueAllObjectLua('obj:queueGameEngineLua("extensions.raceTickerScriptAI.onVehicleSpeed("..tostring(objectId)..","..serialize(obj:getVelocity():length())..")")')
end

local function ping(seconds)
  local durationSeconds = tonumber(seconds)
  if not durationSeconds then
    durationSeconds = 3
  end

  activeUntilMs = nowMs() + math.max(durationSeconds, 0) * 1000
end

local function onVehicleScriptState(vehId, data)
  local normalizedVehId = touchVeh(vehId)
  if not normalizedVehId then
    return
  end

  if type(data) == "table" then
    scriptStateByVehId[normalizedVehId] = copyTable(data)
  else
    scriptStateByVehId[normalizedVehId] = nil
  end
end

local function onVehicleFuel(vehId, fuelValue)
  local normalizedVehId = touchVeh(vehId)
  if not normalizedVehId then
    return
  end

  fuelByVehId[normalizedVehId] = fuelValue
end

local function onVehicleSpeed(vehId, speedValue)
  local normalizedVehId = touchVeh(vehId)
  if not normalizedVehId then
    return
  end

  speedByVehId[normalizedVehId] = tonumber(speedValue) or 0
end

local function onVehicleSubmitInfo(vehId, data)
  onVehicleScriptState(vehId, data)
end

local function getState()
  ping(3)
  pruneStale()
  refreshCarColors(false)

  local scriptState = {}
  local fuelData = {}
  local speedData = {}
  local uiConfig = getUiConfig()

  for vehId, data in pairs(scriptStateByVehId) do
    scriptState[vehId] = copyTable(data)
  end

  for vehId, value in pairs(fuelByVehId) do
    fuelData[vehId] = value
  end

  for vehId, value in pairs(speedByVehId) do
    speedData[vehId] = value
  end

  return {
    scriptState = scriptState,
    fuelData = fuelData,
    speedData = speedData,
    carColors = copyTable(carColorsCache),
    carColorsCsvPath = carColorsCsvPath,
    playerVehId = be and be.getPlayerVehicleID and be:getPlayerVehicleID(0) or nil,
    lapTiming = lapTiming.getState(uiConfig),
    timestamp = nowMs()
  }
end

local function onUpdate(dtReal, dtSim, dtRaw)
  local currentTimeMs = nowMs()
  if currentTimeMs > activeUntilMs then
    pruneStale()
    return
  end

  if currentTimeMs - lastPollMs >= pollIntervalMs then
    lastPollMs = currentTimeMs
    pollVehicles()
  end

  pruneStale()
  lapTiming.update(dtSim or 0, {
    scriptStateByVehId = scriptStateByVehId,
    enableRaceSplits = shouldTrackLapTiming()
  })
end

M.onUpdate = onUpdate
M.onVehicleScriptState = onVehicleScriptState
M.onVehicleFuel = onVehicleFuel
M.onVehicleSpeed = onVehicleSpeed
M.onVehicleSubmitInfo = onVehicleSubmitInfo
M.getState = getState
M.getUiConfig = getUiConfig
M.saveUiConfig = saveUiConfig
M.ping = ping

return M
