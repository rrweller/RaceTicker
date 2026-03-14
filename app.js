angular.module('beamng.apps').directive('raceTicker', ['$interval', function ($interval) {
  var UI_CONFIG_STORAGE_KEY = 'apps:raceTicker.uiConfig'
  var DEFAULT_SERIES_TEXT = 'RACE'
  var DEFAULT_SHOW_LAPS_DOWN = true
  var UI_SCALE_OPTIONS = [
    { label: '50%', value: 0.5 },
    { label: '66%', value: 2 / 3 },
    { label: '75%', value: 0.75 },
    { label: '100%', value: 1 },
    { label: '125%', value: 1.25 },
    { label: '150%', value: 1.5 }
  ]

  return {
    templateUrl: '/ui/modules/apps/RaceTicker/app.html',
    replace: false,
    restrict: 'E',
    scope: false,
    link: function (scope) {
      var ctrl = scope.raceTicker
      ctrl.initialLoad()

      var pollPromise = $interval(function () {
        ctrl.refresh()
      }, 250)

      scope.$on('$destroy', function () {
        $interval.cancel(pollPromise)
        bngApi.engineLua('if extensions.raceTickerScriptAI then extensions.raceTickerScriptAI.ping(0) end')
      })

      scope.$on('VehicleFocusChanged', function () {
        ctrl.refresh()
      })

      scope.$on('VehicleReset', function () {
        ctrl.refresh()
      })

      scope.$on('ScenarioRestarted', function () {
        ctrl.refresh()
      })
    },
    controller: function ($scope) {
      var DEFAULT_LINE_ERROR_TOLERANCE = 5
      var LINE_ERROR_TOLERANCE_OPTIONS = [2, 3, 4, 5, 6, 7, 8]
      var ERROR_SENSITIVITY = 5
      var JUMP_INTERVAL = 10
      var JUMP_GRACE_SECONDS = 5
      var STALL_PROGRESS_EPSILON = 0.35
      var STALL_GRACE_SECONDS = 4
      var STALL_MIN_SCRIPT_TIME = 1.5
      var STALL_SPEED_THRESHOLD = 1
      var vm = this
      vm.loading = false
      vm.nameRequests = {}
      vm.vehicleNames = {}
      vm.vehiclesById = {}
      vm.jumpCounter = 0
      vm.ui = {
        settingsOpen: false
      }
      vm.lineErrorToleranceSteps = LINE_ERROR_TOLERANCE_OPTIONS.slice()
      vm.settings = {
        showFuel: false,
        showLapsDown: DEFAULT_SHOW_LAPS_DOWN,
        uiScale: 1,
        seriesText: DEFAULT_SERIES_TEXT,
        lineErrorTolerance: DEFAULT_LINE_ERROR_TOLERANCE
      }
      vm.state = {
        totalLaps: 0,
        leaderLap: 0,
        lineEnd: 0,
        rows: [],
        statusText: 'Start a ScriptAI line in Script AI Manager to populate the ticker.',
        manualLapCount: 0
      }

      vm.initialLoad = function () {
        applyUiConfig(readLocalUiConfig())
        bngApi.engineLua('extensions.load("raceTickerScriptAI")')
        requestSavedUiConfig()
        vm.refresh()
      }

      vm.refresh = function () {
        if (vm.loading) {
          return
        }

        vm.loading = true
        bngApi.engineLua(
          '(function() if not extensions.raceTickerScriptAI then extensions.load("raceTickerScriptAI") end return extensions.raceTickerScriptAI and extensions.raceTickerScriptAI.getState and extensions.raceTickerScriptAI.getState() or {} end)()',
          function (payload) {
            finishRefresh(function () {
              applyState(payload || {})
            })
          }
        )
      }

      vm.incrementManualLaps = function () {
        vm.state.manualLapCount = vm.state.manualLapCount + 1
        persistUiConfig()
        vm.refresh()
      }

      vm.decrementManualLaps = function () {
        vm.state.manualLapCount = Math.max(vm.state.manualLapCount - 1, 0)
        persistUiConfig()
        vm.refresh()
      }

      vm.toggleSettings = function () {
        vm.ui.settingsOpen = !vm.ui.settingsOpen
      }

      vm.setFuelVisible = function (visible) {
        vm.settings.showFuel = !!visible
        persistUiConfig()
        vm.refresh()
      }

      vm.setLeaderDisplayMode = function (useLapsDown) {
        vm.settings.showLapsDown = !!useLapsDown
        persistUiConfig()
        vm.refresh()
      }

      vm.incrementScale = function () {
        var currentIndex = getUiScaleIndex(vm.settings.uiScale)
        vm.settings.uiScale = UI_SCALE_OPTIONS[Math.min(currentIndex + 1, UI_SCALE_OPTIONS.length - 1)].value
        persistUiConfig()
      }

      vm.decrementScale = function () {
        var currentIndex = getUiScaleIndex(vm.settings.uiScale)
        vm.settings.uiScale = UI_SCALE_OPTIONS[Math.max(currentIndex - 1, 0)].value
        persistUiConfig()
      }

      vm.scaleLabel = function () {
        return getUiScaleOption(vm.settings.uiScale).label
      }

      vm.incrementLineErrorTolerance = function () {
        var currentIndex = getLineErrorToleranceIndex(vm.settings.lineErrorTolerance)
        vm.settings.lineErrorTolerance = LINE_ERROR_TOLERANCE_OPTIONS[Math.min(currentIndex + 1, LINE_ERROR_TOLERANCE_OPTIONS.length - 1)]
        persistUiConfig()
        vm.refresh()
      }

      vm.decrementLineErrorTolerance = function () {
        var currentIndex = getLineErrorToleranceIndex(vm.settings.lineErrorTolerance)
        vm.settings.lineErrorTolerance = LINE_ERROR_TOLERANCE_OPTIONS[Math.max(currentIndex - 1, 0)]
        persistUiConfig()
        vm.refresh()
      }

      vm.lineErrorSensitivityFillStyle = function () {
        return {
          width: getLineErrorTolerancePercent(vm.settings.lineErrorTolerance) + '%'
        }
      }

      vm.lineErrorSensitivityThumbStyle = function () {
        return {
          left: getLineErrorTolerancePercent(vm.settings.lineErrorTolerance) + '%'
        }
      }

      vm.isLineErrorToleranceStepActive = function (value) {
        return getLineErrorTolerance(value) <= getLineErrorTolerance(vm.settings.lineErrorTolerance)
      }

      vm.scaleStyle = function () {
        var scale = getUiScaleOption(vm.settings.uiScale).value
        var style = {
          transform: 'scale(' + scale + ')'
        }

        if (scale > 1) {
          style.width = (100 / scale).toFixed(3) + '%'
          style.height = (100 / scale).toFixed(3) + '%'
        } else {
          style.width = '100%'
          style.height = '100%'
        }

        return style
      }

      vm.persistUiConfig = function () {
        persistUiConfig()
      }

      vm.seriesLabel = function () {
        return sanitizeSeriesText(vm.settings.seriesText)
      }

      vm.bannerLabel = function () {
        if (vm.state.rows.length > 0 && vm.state.totalLaps > 0) {
          return ('Lap ' + vm.state.leaderLap + ' / ' + vm.state.totalLaps).toUpperCase()
        }

        if (vm.state.manualLapCount > 0) {
          return ('Race ' + vm.state.manualLapCount + ' Laps').toUpperCase()
        }

        return 'ScriptAI Timing'
      }

      vm.sourceLabel = function () {
        return vm.state.rows.length > 0 ? 'Live' : 'Standby'
      }

      vm.displayName = function (name) {
        return String(name || '').toUpperCase()
      }

      vm.formatPosition = function (position) {
        var numericPosition = parseInteger(position)
        if (numericPosition === null) {
          return '--'
        }

        return numericPosition < 10 ? '0' + numericPosition : String(numericPosition)
      }

      vm.jumpToVehicle = function (vehId) {
        var numericVehId = parseInteger(vehId)
        if (numericVehId === null) {
          return
        }

        bngApi.engineLua(
          'local obj = scenetree.findObject(' + numericVehId + '); if obj and be and be.enterVehicle then be:enterVehicle(0, obj) end'
        )
      }

      function requestSavedUiConfig() {
        bngApi.engineLua(
          '(function() if not extensions.raceTickerScriptAI then extensions.load("raceTickerScriptAI") end return extensions.raceTickerScriptAI and extensions.raceTickerScriptAI.getUiConfig and extensions.raceTickerScriptAI.getUiConfig() or nil end)()',
          function (config) {
            $scope.$evalAsync(function () {
              applyUiConfig(config)
              persistUiConfig()
              vm.refresh()
            })
          }
        )
      }

      function applyState(payload) {
        var now = toNumber(payload.timestamp, Date.now())
        var scriptState = normalizeLuaObject(payload.scriptState)
        var fuelData = normalizeLuaObject(payload.fuelData)
        var speedData = normalizeLuaObject(payload.speedData)
        var playerVehId = parseInteger(payload.playerVehId)
        var lineErrorTolerance = getLineErrorTolerance(vm.settings.lineErrorTolerance)
        var lineEnd = 0
        var seenVehIds = {}

        vm.jumpCounter = vm.jumpCounter + 1
        if (vm.jumpCounter >= JUMP_INTERVAL) {
          vm.jumpCounter = 0
        }

        angular.forEach(scriptState, function (value, key) {
          if (!value || typeof value !== 'object') {
            return
          }

          var vehId = parseInteger(key)
          if (vehId === null) {
            return
          }

          var scriptTime = toNumber(value.scriptTime, null)
          if (scriptTime === null) {
            return
          }

          ensureVehicleName(vehId)
          seenVehIds[vehId] = true

          var entry = vm.vehiclesById[vehId]
          if (!entry) {
            entry = {
              vehId: vehId,
              time: scriptTime,
              lastScriptTime: scriptTime,
              storedScriptTime: scriptTime,
              averageLineError: 0,
              crashed: false,
              jumped: false,
              stalled: false,
              scriptTimeAtSave: scriptTime,
              realTimeAtSave: now,
              stallScriptTimeAtSave: scriptTime,
              stallRealTimeAtSave: now,
              endScriptTime: 0,
              fuel: null,
              speed: 0
            }
            vm.vehiclesById[vehId] = entry
          }

          var previousScriptTime = toNumber(entry.lastScriptTime, scriptTime)
          if (scriptTime + 1 < previousScriptTime) {
            entry.averageLineError = 0
            entry.crashed = false
            entry.jumped = false
            entry.stalled = false
            entry.storedScriptTime = scriptTime
            entry.scriptTimeAtSave = scriptTime
            entry.realTimeAtSave = now
            entry.stallScriptTimeAtSave = scriptTime
            entry.stallRealTimeAtSave = now
            entry.endScriptTime = 0
          }

          entry.time = scriptTime
          entry.lastScriptTime = scriptTime
          entry.endScriptTime = Math.max(toNumber(value.endScriptTime, 0), entry.endScriptTime || 0)
          lineEnd = Math.max(lineEnd, entry.endScriptTime)

          var lineError = Math.abs(toNumber(value.posError, 0))
          entry.averageLineError = ((entry.averageLineError * ERROR_SENSITIVITY) + lineError) / (ERROR_SENSITIVITY + 1)

          if (entry.averageLineError > lineErrorTolerance) {
            if (!entry.crashed) {
              entry.crashed = true
              entry.storedScriptTime = previousScriptTime
            }
          } else if (!entry.jumped) {
            entry.crashed = false
            entry.storedScriptTime = scriptTime
          }

          if (vm.jumpCounter === 0) {
            var simDelta = scriptTime - toNumber(entry.scriptTimeAtSave, scriptTime)
            var realDelta = (now - toNumber(entry.realTimeAtSave, now)) / 1000
            if (simDelta > realDelta + JUMP_GRACE_SECONDS) {
              entry.jumped = true
              entry.crashed = true
              entry.storedScriptTime = previousScriptTime
            } else if (!entry.crashed) {
              entry.jumped = false
            }

            entry.scriptTimeAtSave = scriptTime
            entry.realTimeAtSave = now
          }

          if (fuelData[vehId] !== undefined) {
            entry.fuel = fuelData[vehId]
          }

          if (speedData[vehId] !== undefined) {
            entry.speed = toNumber(speedData[vehId], entry.speed || 0)
          }

          updateStallState(entry, scriptTime, now)
        })

        angular.forEach(vm.vehiclesById, function (entry, vehId) {
          if (!seenVehIds[vehId]) {
            delete vm.vehiclesById[vehId]
          }
        })

        var rows = []
        angular.forEach(vm.vehiclesById, function (entry) {
          rows.push({
            vehId: entry.vehId,
            sortTime: (entry.crashed || entry.stalled) ? (entry.jumped ? 0 : toNumber(entry.storedScriptTime, 0)) : toNumber(entry.time, 0),
            fuel: entry.fuel,
            crashed: entry.crashed,
            jumped: entry.jumped,
            stalled: entry.stalled
          })
        })

        rows.sort(function (left, right) {
          if (left.sortTime !== right.sortTime) {
            return right.sortTime - left.sortTime
          }

          return left.vehId - right.vehId
        })

        var totalLaps = Math.max(toNumber(vm.state.manualLapCount, 0), 0)
        var lapLength = totalLaps > 0 && lineEnd > 0 ? lineEnd / totalLaps : 0
        var leaderTime = rows.length > 0 ? rows[0].sortTime : 0
        var leaderLap = lapLength > 0 ? clampLeaderLap(Math.floor(leaderTime / lapLength) + 1, totalLaps) : 0

        angular.forEach(rows, function (row, index) {
          row.position = index + 1
          row.name = getVehicleName(row.vehId)
          row.gapLabel = buildGapLabel(rows, index, lapLength, totalLaps, lineEnd)
          row.fuelLabel = formatFuelLabel(row.fuel)
          row.isLeader = index === 0
          row.isPlayerFocus = playerVehId !== null && playerVehId === row.vehId
          row.isWarning = row.crashed || row.jumped || row.stalled
        })

        vm.state.totalLaps = totalLaps
        vm.state.leaderLap = leaderLap
        vm.state.lineEnd = rows.length > 0 ? lineEnd : 0
        vm.state.rows = rows
        vm.state.statusText = rows.length > 0
          ? 'Select a row to jump to that car.'
          : 'Start a ScriptAI line in Script AI Manager to populate the ticker.'
      }

      function buildGapLabel(rows, index, lapLength, totalLaps, lineEnd) {
        if (!rows[index]) {
          return '--'
        }

        var leader = rows[0]
        var row = rows[index]
        if (index === 0) {
          if (vm.settings.showLapsDown) {
            return 'Leader'
          }

          if (lineEnd > 0) {
            return Math.max(Math.round((1 - (leader.sortTime / lineEnd)) * 100), 0) + '% left'
          }

          return 'Leader'
        }

        var timeBehind = Math.max(leader.sortTime - row.sortTime, 0)
        if (vm.settings.showLapsDown && lapLength > 0) {
          var lapsBehind = Math.floor(timeBehind / lapLength)
          if (lapsBehind > 0) {
            return '+' + lapsBehind + ' ' + (lapsBehind === 1 ? 'Lap' : 'Laps')
          }
        }

        return '+' + timeBehind.toFixed(2) + 's'
      }

      function updateStallState(entry, scriptTime, now) {
        var speed = toNumber(entry.speed, 0)
        var progressDelta = scriptTime - toNumber(entry.stallScriptTimeAtSave, scriptTime)
        var stalledDuration = (now - toNumber(entry.stallRealTimeAtSave, now)) / 1000
        var hasMeaningfulProgress = progressDelta > STALL_PROGRESS_EPSILON
        var isMoving = speed > STALL_SPEED_THRESHOLD

        if (entry.jumped || entry.crashed || scriptTime < STALL_MIN_SCRIPT_TIME || hasMeaningfulProgress || isMoving) {
          entry.stalled = false
          entry.stallScriptTimeAtSave = scriptTime
          entry.stallRealTimeAtSave = now
          return
        }

        if (stalledDuration >= STALL_GRACE_SECONDS && !entry.stalled) {
          entry.stalled = true
          entry.storedScriptTime = scriptTime
        }
      }

      function ensureVehicleName(vehId) {
        if (vehId === null || vm.vehicleNames[vehId] !== undefined || vm.nameRequests[vehId]) {
          return
        }

        vm.nameRequests[vehId] = true
        bngApi.engineLua(
          '(function() local obj = scenetree.findObject(' + vehId + '); return (obj and obj.getJBeamFilename and obj:getJBeamFilename()) or "" end)()',
          function (name) {
            $scope.$evalAsync(function () {
              vm.vehicleNames[vehId] = simplifyVehicleName(name, vehId)
              delete vm.nameRequests[vehId]
            })
          }
        )
      }

      function getVehicleName(vehId) {
        if (vm.vehicleNames[vehId] !== undefined) {
          return vm.vehicleNames[vehId]
        }

        return 'Vehicle ' + vehId
      }

      function simplifyVehicleName(rawName, vehId) {
        var value = String(rawName || '')
        value = value.replace(/\\/g, '/')
        value = value.replace(/^.*\//, '')
        value = value.replace(/\.jbeam$/i, '')
        value = value.replace(/[_-]+/g, ' ')
        value = value.replace(/\s+/g, ' ').trim()
        if (!value) {
          return 'Vehicle ' + vehId
        }

        var parts = value.split(' ')
        for (var index = 0; index < parts.length; index++) {
          if (!parts[index]) {
            continue
          }

          parts[index] = parts[index].charAt(0).toUpperCase() + parts[index].slice(1)
        }

        return parts.join(' ')
      }

      function applyUiConfig(config) {
        if (!config || typeof config !== 'object') {
          return
        }

        vm.settings.showFuel = !!config.showFuel
        vm.settings.showLapsDown = config.showLapsDown === undefined ? DEFAULT_SHOW_LAPS_DOWN : !!config.showLapsDown
        vm.settings.uiScale = getUiScaleOption(config.uiScale).value
        vm.settings.seriesText = sanitizeSeriesText(config.seriesText)
        vm.settings.lineErrorTolerance = getLineErrorTolerance(config.lineErrorTolerance)

        var manualLapCount = parseInteger(config.manualLapCount)
        if (manualLapCount !== null) {
          vm.state.manualLapCount = Math.max(manualLapCount, 0)
        }
      }

      function buildUiConfigSnapshot() {
        return {
          showFuel: !!vm.settings.showFuel,
          showLapsDown: !!vm.settings.showLapsDown,
          uiScale: getUiScaleOption(vm.settings.uiScale).value,
          seriesText: sanitizeSeriesText(vm.settings.seriesText),
          lineErrorTolerance: getLineErrorTolerance(vm.settings.lineErrorTolerance),
          manualLapCount: Math.max(parseInteger(vm.state.manualLapCount) || 0, 0)
        }
      }

      function persistUiConfig(options) {
        var snapshot = buildUiConfigSnapshot()
        applyUiConfig(snapshot)
        writeLocalUiConfig(snapshot)

        if (options && options.skipLua) {
          return
        }

        bngApi.engineLua(
          'if not extensions.raceTickerScriptAI then extensions.load("raceTickerScriptAI") end if extensions.raceTickerScriptAI and extensions.raceTickerScriptAI.saveUiConfig then extensions.raceTickerScriptAI.saveUiConfig(' + bngApi.serializeToLua(snapshot) + ') end'
        )
      }

      function readLocalUiConfig() {
        try {
          var rawValue = localStorage.getItem(UI_CONFIG_STORAGE_KEY)
          if (!rawValue) {
            return null
          }

          return JSON.parse(rawValue)
        } catch (error) {
          return null
        }
      }

      function writeLocalUiConfig(config) {
        try {
          localStorage.setItem(UI_CONFIG_STORAGE_KEY, JSON.stringify(config))
        } catch (error) {
          return null
        }

        return true
      }

      function sanitizeSeriesText(value) {
        var text = String(value || '')
        text = text.replace(/\s+/g, ' ').trim()
        if (!text) {
          return DEFAULT_SERIES_TEXT
        }

        return text.slice(0, 24)
      }

      function getUiScaleIndex(scale) {
        var targetValue = getUiScaleOption(scale).value
        for (var index = 0; index < UI_SCALE_OPTIONS.length; index++) {
          if (UI_SCALE_OPTIONS[index].value === targetValue) {
            return index
          }
        }

        return 3
      }

      function getUiScaleOption(scale) {
        var numericScale = toNumber(scale, 1)
        var bestOption = UI_SCALE_OPTIONS[0]
        var bestDistance = Math.abs(numericScale - bestOption.value)

        for (var index = 1; index < UI_SCALE_OPTIONS.length; index++) {
          var option = UI_SCALE_OPTIONS[index]
          var distance = Math.abs(numericScale - option.value)
          if (distance < bestDistance) {
            bestOption = option
            bestDistance = distance
          }
        }

        return bestOption
      }

      function getLineErrorTolerance(value) {
        var numericValue = toNumber(value, DEFAULT_LINE_ERROR_TOLERANCE)
        var bestValue = LINE_ERROR_TOLERANCE_OPTIONS[0]
        var bestDistance = Math.abs(numericValue - bestValue)

        for (var index = 1; index < LINE_ERROR_TOLERANCE_OPTIONS.length; index++) {
          var optionValue = LINE_ERROR_TOLERANCE_OPTIONS[index]
          var distance = Math.abs(numericValue - optionValue)
          if (distance < bestDistance) {
            bestValue = optionValue
            bestDistance = distance
          }
        }

        return bestValue
      }

      function getLineErrorToleranceIndex(value) {
        var normalizedValue = getLineErrorTolerance(value)
        for (var index = 0; index < LINE_ERROR_TOLERANCE_OPTIONS.length; index++) {
          if (LINE_ERROR_TOLERANCE_OPTIONS[index] === normalizedValue) {
            return index
          }
        }

        return Math.floor(LINE_ERROR_TOLERANCE_OPTIONS.length / 2)
      }

      function getLineErrorTolerancePercent(value) {
        if (LINE_ERROR_TOLERANCE_OPTIONS.length <= 1) {
          return 50
        }

        return (getLineErrorToleranceIndex(value) / (LINE_ERROR_TOLERANCE_OPTIONS.length - 1)) * 100
      }

      function normalizeLuaObject(value) {
        return value && typeof value === 'object' ? value : {}
      }

      function parseInteger(value) {
        var numericValue = Number(value)
        if (!isFinite(numericValue)) {
          return null
        }

        return Math.floor(numericValue)
      }

      function toNumber(value, fallback) {
        var numericValue = Number(value)
        return isFinite(numericValue) ? numericValue : fallback
      }

      function clampLeaderLap(leaderLap, totalLaps) {
        if (totalLaps <= 0) {
          return 0
        }

        return Math.max(1, Math.min(Math.floor(leaderLap || 1), totalLaps))
      }

      function formatFuelLabel(value) {
        var numericValue = toNumber(value, null)
        if (numericValue === null) {
          return '--'
        }

        if (numericValue >= 0 && numericValue <= 1.05) {
          return (numericValue * 100).toFixed(1) + '%'
        }

        return numericValue.toFixed(1)
      }

      function finishRefresh(applyStateCallback) {
        $scope.$evalAsync(function () {
          applyStateCallback()
          vm.loading = false
        })
      }
    },
    controllerAs: 'raceTicker'
  }
}])
