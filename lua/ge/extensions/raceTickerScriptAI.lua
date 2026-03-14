local M = {}

local uiConfigPath = "/settings/raceTicker.json"
local uiScaleOptions = {0.5, 2 / 3, 0.75, 1, 1.25, 1.5}

local scriptStateByVehId = {}
local fuelByVehId = {}
local lastSeenMsByVehId = {}
local uiConfigCache = nil

local activeUntilMs = 0
local lastPollMs = 0
local pollIntervalMs = 200
local staleAfterMs = 1500

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

local function sanitizeUiConfig(config)
  local data = type(config) == "table" and config or {}

  return {
    showFuel = data.showFuel and true or false,
    showLapsDown = data.showLapsDown and true or false,
    uiScale = normalizeUiScale(data.uiScale),
    seriesText = sanitizeSeriesText(data.seriesText),
    manualLapCount = math.max(math.floor(tonumber(data.manualLapCount) or 0), 0)
  }
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
    end
  end
end

local function pollVehicles()
  if not be or not be.queueAllObjectLua then
    return
  end

  be:queueAllObjectLua('obj:queueGameEngineLua("extensions.raceTickerScriptAI.onVehicleScriptState("..tostring(objectId)..","..serialize(ai.scriptState())..")")')
  be:queueAllObjectLua('obj:queueGameEngineLua("extensions.raceTickerScriptAI.onVehicleFuel("..tostring(objectId)..","..serialize(electrics.values.fuel)..")")')
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

local function onVehicleSubmitInfo(vehId, data)
  onVehicleScriptState(vehId, data)
end

local function getState()
  ping(3)
  pruneStale()

  local scriptState = {}
  local fuelData = {}

  for vehId, data in pairs(scriptStateByVehId) do
    scriptState[vehId] = copyTable(data)
  end

  for vehId, value in pairs(fuelByVehId) do
    fuelData[vehId] = value
  end

  return {
    scriptState = scriptState,
    fuelData = fuelData,
    playerVehId = be and be.getPlayerVehicleID and be:getPlayerVehicleID(0) or nil,
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
end

M.onUpdate = onUpdate
M.onVehicleScriptState = onVehicleScriptState
M.onVehicleFuel = onVehicleFuel
M.onVehicleSubmitInfo = onVehicleSubmitInfo
M.getState = getState
M.getUiConfig = getUiConfig
M.saveUiConfig = saveUiConfig
M.ping = ping

return M
