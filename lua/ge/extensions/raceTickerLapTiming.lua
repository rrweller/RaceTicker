local M = {}

local lapResetLeaderTimeMax = 3
local lapResetDropThreshold = 2
local lapMinHalfWidth = 10
local lapMaxHalfWidth = 40
local lapObservedHalfWidthPadding = 5
local lapGateEdgePadding = 2
local lapGateExpansionPadding = 3
local lapRearmDistance = 6
local lapMinAlignment = 0.15
local lapTeleportDistance = 140
local lapMinSegmentLength = 0.02
local function clamp(value, minValue, maxValue)
  if value < minValue then
    return minValue
  end
  if value > maxValue then
    return maxValue
  end
  return value
end

local function createLapSessionState(sessionId)
  return {
    sessionId = sessionId or 0,
    active = false,
    sessionTime = 0,
    vehiclesByVehId = {},
    orderedVehIds = {},
    gate = nil,
    leaderLap = 0,
    anyLiveFirstLap = false,
    hasPostedLap = false,
    hadActiveScript = false,
    lastLeaderScriptTime = nil,
    statusText = "RaceSplits ready. Start a shared ScriptAI line to arm the lap gate.",
    routeTotalTime = 0
  }
end

local lapSession = createLapSessionState(0)

local function clearLapSession(statusText)
  lapSession = createLapSessionState(lapSession.sessionId)
  if statusText and statusText ~= "" then
    lapSession.statusText = statusText
  end
end

local function nextLapSessionId()
  return (lapSession.sessionId or 0) + 1
end

local function vec3Copy(value)
  if not value then
    return nil
  end

  return {
    x = tonumber(value.x) or 0,
    y = tonumber(value.y) or 0,
    z = tonumber(value.z) or 0
  }
end

local function vec3Sub(left, right)
  return {
    x = (left and left.x or 0) - (right and right.x or 0),
    y = (left and left.y or 0) - (right and right.y or 0),
    z = (left and left.z or 0) - (right and right.z or 0)
  }
end

local function vec3Scale(vector, scalar)
  return {
    x = (vector and vector.x or 0) * scalar,
    y = (vector and vector.y or 0) * scalar,
    z = (vector and vector.z or 0) * scalar
  }
end

local function vec3Lerp(left, right, fraction)
  local t = clamp(tonumber(fraction) or 0, 0, 1)
  return {
    x = (left.x or 0) + (((right.x or 0) - (left.x or 0)) * t),
    y = (left.y or 0) + (((right.y or 0) - (left.y or 0)) * t),
    z = (left.z or 0) + (((right.z or 0) - (left.z or 0)) * t)
  }
end

local function vec3Length(vector)
  if not vector then
    return 0
  end

  return math.sqrt(
    ((vector.x or 0) * (vector.x or 0)) +
    ((vector.y or 0) * (vector.y or 0)) +
    ((vector.z or 0) * (vector.z or 0))
  )
end

local function vec3Normalize(vector, fallback)
  local length = vec3Length(vector)
  if length <= 0.0001 then
    return fallback and vec3Copy(fallback) or nil
  end

  local inverseLength = 1 / length
  return {
    x = (vector.x or 0) * inverseLength,
    y = (vector.y or 0) * inverseLength,
    z = (vector.z or 0) * inverseLength
  }
end

local function dotVec3(left, right)
  if not left or not right then
    return 0
  end

  return ((left.x or 0) * (right.x or 0)) +
    ((left.y or 0) * (right.y or 0)) +
    ((left.z or 0) * (right.z or 0))
end

local function projectLateralDistance(position, gate)
  if not position or not gate then
    return 0
  end

  return math.abs(dotVec3(vec3Sub(position, gate.center), gate.lateral))
end

local function gateSignedDistance(position, gate)
  if not position or not gate then
    return 0
  end

  return dotVec3(vec3Sub(position, gate.center), gate.normal)
end

local function computeRoadHalfWidth(position)
  if not position or not map or not map.findClosestRoad or not map.getMap or not vec3 then
    return nil
  end

  local ok, roadStartNode, roadEndNode, roadDistance = pcall(map.findClosestRoad, vec3(position.x, position.y, position.z))
  if not ok or not roadStartNode or not roadEndNode then
    return nil
  end

  if (tonumber(roadDistance) or math.huge) > 30 then
    return nil
  end

  local mapData = map.getMap and map.getMap() or nil
  local nodes = mapData and mapData.nodes or nil
  local nodeA = nodes and nodes[roadStartNode] or nil
  local nodeB = nodes and nodes[roadEndNode] or nil
  if not nodeA or not nodeB or not nodeA.pos or not nodeB.pos then
    return nil
  end

  local posVec = vec3(position.x, position.y, position.z)
  local pointA = vec3(nodeA.pos)
  local pointB = vec3(nodeB.pos)
  local xnorm = clamp(posVec:xnormOnLine(pointA, pointB), 0, 1)
  local radiusA = tonumber(nodeA.radius) or 5
  local radiusB = tonumber(nodeB.radius) or radiusA
  return math.max(4, radiusA + ((radiusB - radiusA) * xnorm))
end

local function getCurrentScriptAIRecordings()
  if not extensions then
    return nil
  end

  local managers = {}
  if extensions.editor_scriptAIManagerHUSK then
    table.insert(managers, extensions.editor_scriptAIManagerHUSK)
  end
  if extensions.editor_scriptAIManager then
    table.insert(managers, extensions.editor_scriptAIManager)
  end

  for _, manager in ipairs(managers) do
    if manager and type(manager.getCurrentRecordings) == "function" then
      local ok, recordings = pcall(manager.getCurrentRecordings)
      if ok and type(recordings) == "table" and next(recordings) ~= nil then
        return recordings
      end
    end
  end

  return nil
end

local function getRecordingForVehId(recordings, vehId)
  if type(recordings) ~= "table" then
    return nil
  end

  return recordings[vehId] or recordings[tostring(vehId)]
end

local function getPathPoint(path, index)
  local entry = path and path[index]
  if type(entry) ~= "table" then
    return nil
  end

  return {
    x = tonumber(entry.x) or 0,
    y = tonumber(entry.y) or 0,
    z = tonumber(entry.z) or 0,
    t = tonumber(entry.t) or 0
  }
end

local function findNextDirection(path, startIndex, fallbackStart)
  local basePoint = fallbackStart or getPathPoint(path, startIndex)
  if not basePoint then
    return nil
  end

  for index = startIndex + 1, #path do
    local nextPoint = getPathPoint(path, index)
    local direction = vec3Normalize(vec3Sub(nextPoint, basePoint), nil)
    if direction then
      return direction
    end
  end

  return nil
end

local function resolveRecordingGateSeed(recording)
  if type(recording) ~= "table" or type(recording.path) ~= "table" or #recording.path < 2 then
    return nil
  end

  local path = recording.path
  local timeOffset = math.max(tonumber(recording.timeOffset) or 0, 0)
  local totalTime = math.max((tonumber(path[#path] and path[#path].t) or 0) - timeOffset, 0)
  local startPoint = getPathPoint(path, 1)
  local direction = nil
  if not startPoint then
    return nil
  end

  if timeOffset > 0 then
    local previousPoint = startPoint
    for index = 2, #path do
      local nextPoint = getPathPoint(path, index)
      if nextPoint and nextPoint.t >= timeOffset then
        local previousTime = tonumber(previousPoint.t) or 0
        local nextTime = tonumber(nextPoint.t) or previousTime
        local fraction = nextTime > previousTime and ((timeOffset - previousTime) / (nextTime - previousTime)) or 0
        startPoint = vec3Lerp(previousPoint, nextPoint, fraction)
        direction = vec3Normalize(vec3Sub(nextPoint, previousPoint), nil)
        break
      end
      previousPoint = nextPoint
    end
  end

  direction = direction or findNextDirection(path, 1, startPoint)
  if not direction then
    return nil
  end

  return {
    center = {
      x = startPoint.x or 0,
      y = startPoint.y or 0,
      z = startPoint.z or 0
    },
    normal = direction,
    lateral = vec3Normalize({
      x = -(direction.y or 0),
      y = direction.x or 0,
      z = 0
    }, {x = 1, y = 0, z = 0}),
    routeTotalTime = totalTime
  }
end

local function collectLiveVehicles()
  local liveVehicles = {}
  for _, vehicle in ipairs(getAllVehiclesByType() or {}) do
    if vehicle and vehicle.getID and vehicle.getPosition then
      local vehId = vehicle:getID()
      local position = vehicle:getPosition()
      liveVehicles[vehId] = {
        position = vec3Copy(position)
      }
    end
  end
  return liveVehicles
end

local function buildActiveScriptVehicles(scriptStateByVehId)
  local activeVehicles = {}
  for vehId, data in pairs(scriptStateByVehId or {}) do
    if type(data) == "table" and tostring(data.status or "") == "following" then
      table.insert(activeVehicles, {
        vehId = vehId,
        scriptTime = tonumber(data.scriptTime) or 0
      })
    end
  end

  table.sort(activeVehicles, function(left, right)
    if left.scriptTime ~= right.scriptTime then
      return left.scriptTime > right.scriptTime
    end
    return left.vehId < right.vehId
  end)

  return activeVehicles
end

local function makeLapVehicleState(vehId, startOrdinal)
  return {
    vehId = vehId,
    startOrdinal = startOrdinal,
    lapStartTime = 0,
    completedLapCount = 0,
    totalLapTime = 0,
    bestLapTime = nil,
    averageLapTime = nil,
    lastLapTime = nil,
    armed = false,
    lastPosition = nil,
    lastSide = nil
  }
end

local function addLapVehicle(vehId)
  if lapSession.vehiclesByVehId[vehId] then
    return lapSession.vehiclesByVehId[vehId]
  end

  local entry = makeLapVehicleState(vehId, #lapSession.orderedVehIds + 1)
  lapSession.vehiclesByVehId[vehId] = entry
  table.insert(lapSession.orderedVehIds, vehId)
  return entry
end

local function buildLapGate(activeScriptVehicles, liveVehicles)
  local recordings = getCurrentScriptAIRecordings()
  if type(recordings) ~= "table" then
    return nil, "RaceSplits is waiting for Script AI Manager recordings to build the lap checkpoint."
  end

  local seed = nil
  for _, entry in ipairs(activeScriptVehicles or {}) do
    seed = resolveRecordingGateSeed(getRecordingForVehId(recordings, entry.vehId))
    if seed then
      break
    end
  end

  if not seed then
    return nil, "RaceSplits could not find a usable shared ScriptAI recording for the active cars."
  end

  local observedHalfWidth = 0
  local averageSide = 0
  local observedCount = 0
  for _, entry in ipairs(activeScriptVehicles or {}) do
    local liveVehicle = liveVehicles and liveVehicles[entry.vehId] or nil
    if liveVehicle and liveVehicle.position then
      observedCount = observedCount + 1
      observedHalfWidth = math.max(observedHalfWidth, projectLateralDistance(liveVehicle.position, seed))
      averageSide = averageSide + gateSignedDistance(liveVehicle.position, seed)
    end
  end

  if observedCount > 0 and (averageSide / observedCount) > 0 then
    seed.normal = vec3Scale(seed.normal, -1)
    seed.lateral = vec3Scale(seed.lateral, -1)
  end

  local roadHalfWidth = computeRoadHalfWidth(seed.center)
  local halfWidth = clamp(math.max(lapMinHalfWidth, observedHalfWidth + lapObservedHalfWidthPadding, (roadHalfWidth or 0) + 1), lapMinHalfWidth, lapMaxHalfWidth)

  return {
    center = seed.center,
    normal = seed.normal,
    lateral = seed.lateral,
    halfWidth = halfWidth,
    rearmDistance = lapRearmDistance,
    minAlignment = lapMinAlignment,
    minLapTime = clamp((seed.routeTotalTime or 0) * 0.2, 3, 30),
    routeTotalTime = seed.routeTotalTime or 0,
    source = "scriptAIRecording"
  }, nil
end

local function startLapSession(activeScriptVehicles)
  local liveVehicles = collectLiveVehicles()
  lapSession = createLapSessionState(nextLapSessionId())
  lapSession.active = true
  lapSession.hadActiveScript = true
  lapSession.lastLeaderScriptTime = activeScriptVehicles[1] and activeScriptVehicles[1].scriptTime or nil

  for _, entry in ipairs(activeScriptVehicles or {}) do
    local lapVehicle = addLapVehicle(entry.vehId)
    if lapVehicle and liveVehicles[entry.vehId] then
      lapVehicle.lastPosition = vec3Copy(liveVehicles[entry.vehId].position)
    end
  end

  lapSession.gate, lapSession.statusText = buildLapGate(activeScriptVehicles, liveVehicles)
  if lapSession.gate then
    lapSession.routeTotalTime = lapSession.gate.routeTotalTime or 0
    lapSession.statusText = "RaceSplits timing is live."
    for _, vehId in ipairs(lapSession.orderedVehIds) do
      local lapVehicle = lapSession.vehiclesByVehId[vehId]
      local liveVehicle = liveVehicles[vehId]
      if lapVehicle and liveVehicle then
        lapVehicle.lastSide = gateSignedDistance(liveVehicle.position, lapSession.gate)
      end
    end
  end
end

local function syncLapVehicles(activeScriptVehicles, liveVehicles)
  if lapSession.hasPostedLap then
    return
  end

  for _, entry in ipairs(activeScriptVehicles or {}) do
    local lapVehicle = addLapVehicle(entry.vehId)
    if lapVehicle and not lapVehicle.lastPosition and liveVehicles and liveVehicles[entry.vehId] then
      lapVehicle.lastPosition = vec3Copy(liveVehicles[entry.vehId].position)
    end
  end
end

local function markLapPosted(lapVehicle, lapDuration, crossingTime, crossingLateral)
  lapVehicle.completedLapCount = lapVehicle.completedLapCount + 1
  lapVehicle.totalLapTime = lapVehicle.totalLapTime + lapDuration
  lapVehicle.lastLapTime = lapDuration
  lapVehicle.bestLapTime = lapVehicle.bestLapTime and math.min(lapVehicle.bestLapTime, lapDuration) or lapDuration
  lapVehicle.averageLapTime = lapVehicle.totalLapTime / math.max(lapVehicle.completedLapCount, 1)
  lapVehicle.lapStartTime = crossingTime
  lapVehicle.armed = false
  lapSession.hasPostedLap = true

  if lapSession.gate and crossingLateral and crossingLateral > (lapSession.gate.halfWidth - lapGateEdgePadding) then
    lapSession.gate.halfWidth = clamp(crossingLateral + lapGateExpansionPadding, lapSession.gate.halfWidth, lapMaxHalfWidth)
  end
end

local function updateLapVehicle(lapVehicle, liveVehicle, dtSim)
  if not lapVehicle or not liveVehicle or not liveVehicle.position then
    return
  end

  if not lapSession.gate then
    lapVehicle.lastPosition = vec3Copy(liveVehicle.position)
    lapVehicle.lastSide = nil
    return
  end

  local currentPosition = liveVehicle.position
  local previousPosition = lapVehicle.lastPosition
  local currentSide = gateSignedDistance(currentPosition, lapSession.gate)
  local currentLateral = projectLateralDistance(currentPosition, lapSession.gate)

  if not previousPosition then
    lapVehicle.lastPosition = vec3Copy(currentPosition)
    lapVehicle.lastSide = currentSide
    return
  end

  local segment = vec3Sub(currentPosition, previousPosition)
  local segmentLength = vec3Length(segment)
  if segmentLength >= lapTeleportDistance then
    lapVehicle.armed = false
    lapVehicle.lastPosition = vec3Copy(currentPosition)
    lapVehicle.lastSide = currentSide
    return
  end

  if currentLateral <= (lapSession.gate.halfWidth + lapGateEdgePadding) and currentSide <= -lapSession.gate.rearmDistance then
    lapVehicle.armed = true
  end

  local previousSide = lapVehicle.lastSide
  if previousSide ~= nil and
    lapVehicle.armed and
    currentLateral <= (lapSession.gate.halfWidth + lapGateEdgePadding) and
    previousSide <= 0 and
    currentSide >= 0 and
    segmentLength >= lapMinSegmentLength then
    local denominator = currentSide - previousSide
    local fraction = denominator ~= 0 and (-previousSide / denominator) or 0
    if fraction >= 0 and fraction <= 1 then
      local movementDirection = vec3Normalize(segment, nil)
      local alignment = movementDirection and dotVec3(movementDirection, lapSession.gate.normal) or 0
      local crossingPosition = vec3Lerp(previousPosition, currentPosition, fraction)
      local crossingLateral = projectLateralDistance(crossingPosition, lapSession.gate)
      local crossingTime = math.max((lapSession.sessionTime - dtSim) + (dtSim * fraction), lapVehicle.lapStartTime)
      local lapDuration = crossingTime - lapVehicle.lapStartTime

      if alignment >= lapSession.gate.minAlignment and
        crossingLateral <= (lapSession.gate.halfWidth + lapGateEdgePadding) and
        lapDuration >= lapSession.gate.minLapTime then
        markLapPosted(lapVehicle, lapDuration, crossingTime, crossingLateral)
      end
    end
  end

  lapVehicle.lastPosition = vec3Copy(currentPosition)
  lapVehicle.lastSide = currentSide
end

local function updateLapSessionFlags()
  local anyLiveFirstLap = false
  local leaderLap = 0

  for _, vehId in ipairs(lapSession.orderedVehIds or {}) do
    local lapVehicle = lapSession.vehiclesByVehId[vehId]
    if lapVehicle then
      local lapCount = math.max(lapVehicle.completedLapCount or 0, 0)
      if lapCount <= 0 then
        anyLiveFirstLap = true
      end
      leaderLap = math.max(leaderLap, lapCount + 1)
    end
  end

  lapSession.anyLiveFirstLap = anyLiveFirstLap
  lapSession.leaderLap = leaderLap
end

function M.update(dtSim, context)
  local activeScriptVehicles = buildActiveScriptVehicles(context and context.scriptStateByVehId or {})
  local hasActiveScript = #activeScriptVehicles > 0
  local leaderScriptTime = hasActiveScript and activeScriptVehicles[1].scriptTime or nil

  if not (context and context.enableRaceSplits) then
    clearLapSession("RaceSplits is disabled.")
    return
  end

  local isFreshStart = hasActiveScript and
    not lapSession.hadActiveScript and
    leaderScriptTime ~= nil and
    leaderScriptTime <= lapResetLeaderTimeMax
  local isRunReset = hasActiveScript and lapSession.lastLeaderScriptTime ~= nil and leaderScriptTime ~= nil and
    leaderScriptTime <= lapResetLeaderTimeMax and
    (lapSession.lastLeaderScriptTime - leaderScriptTime) >= lapResetDropThreshold

  if isFreshStart or isRunReset then
    startLapSession(activeScriptVehicles)
  end

  lapSession.hadActiveScript = hasActiveScript
  lapSession.lastLeaderScriptTime = leaderScriptTime

  if not lapSession.active then
    return
  end

  lapSession.sessionTime = lapSession.sessionTime + math.max(tonumber(dtSim) or 0, 0)
  local liveVehicles = collectLiveVehicles()

  if not lapSession.gate then
    lapSession.gate, lapSession.statusText = buildLapGate(activeScriptVehicles, liveVehicles)
    if lapSession.gate then
      lapSession.routeTotalTime = lapSession.gate.routeTotalTime or 0
      lapSession.statusText = "RaceSplits timing is live."
      for _, vehId in ipairs(lapSession.orderedVehIds) do
        local lapVehicle = lapSession.vehiclesByVehId[vehId]
        local liveVehicle = liveVehicles[vehId]
        if lapVehicle and liveVehicle then
          lapVehicle.lastPosition = vec3Copy(liveVehicle.position)
          lapVehicle.lastSide = gateSignedDistance(liveVehicle.position, lapSession.gate)
        end
      end
    end
  end

  syncLapVehicles(activeScriptVehicles, liveVehicles)

  for _, vehId in ipairs(lapSession.orderedVehIds or {}) do
    updateLapVehicle(lapSession.vehiclesByVehId[vehId], liveVehicles[vehId], math.max(tonumber(dtSim) or 0, 0))
  end

  updateLapSessionFlags()
end

local function serializeLapGate(gate)
  if not gate then
    return nil
  end

  return {
    center = vec3Copy(gate.center),
    normal = vec3Copy(gate.normal),
    lateral = vec3Copy(gate.lateral),
    halfWidth = gate.halfWidth,
    source = gate.source
  }
end

function M.getState(uiConfig)
  local vehicles = {}
  local participants = {}
  local participantOrder = {}
  for _, vehId in ipairs(lapSession.orderedVehIds or {}) do
    local lapVehicle = lapSession.vehiclesByVehId[vehId]
    if lapVehicle then
      table.insert(participantOrder, vehId)
      participants[vehId] = {
        completedLaps = lapVehicle.completedLapCount,
        currentLapTime = math.max(lapSession.sessionTime - (lapVehicle.lapStartTime or 0), 0),
        bestLapTime = lapVehicle.bestLapTime,
        averageLapTime = lapVehicle.averageLapTime,
        lastLapTime = lapVehicle.lastLapTime
      }
      table.insert(vehicles, {
        vehId = vehId,
        startOrdinal = lapVehicle.startOrdinal,
        completedLapCount = lapVehicle.completedLapCount,
        currentLapTime = math.max(lapSession.sessionTime - (lapVehicle.lapStartTime or 0), 0),
        bestLapTime = lapVehicle.bestLapTime,
        averageLapTime = lapVehicle.averageLapTime,
        lastLapTime = lapVehicle.lastLapTime
      })
    end
  end

  return {
    active = lapSession.active,
    gateReady = lapSession.gate ~= nil,
    sessionTime = lapSession.sessionTime,
    leaderLap = lapSession.leaderLap,
    anyLiveFirstLap = lapSession.anyLiveFirstLap,
    hasLiveTimers = lapSession.anyLiveFirstLap,
    hasPostedLap = lapSession.hasPostedLap,
    routeTotalTime = lapSession.routeTotalTime or 0,
    statusText = lapSession.statusText,
    participantOrder = participantOrder,
    participants = participants,
    vehicles = vehicles,
    gate = uiConfig and uiConfig.showCheckpointDebug and serializeLapGate(lapSession.gate) or nil
  }
end

function M.reset(statusText)
  clearLapSession(statusText)
end

return M
