angular.module('beamng.apps').directive('raceTicker', ['$interval', function ($interval) {
  var UI_CONFIG_STORAGE_KEY = 'apps:raceTicker.uiConfig'
  var DEFAULT_SERIES_TEXT = 'RACE'
  var DEFAULT_SHOW_LAPS_DOWN = true
  var DEFAULT_RELATIVE_GAP = false
  var DEFAULT_SHOW_CAR_NUMBER_BOXES = true
  var DEFAULT_USE_CSV_CAR_COLORS = true
  var APP_STYLESHEET_ID = 'raceTickerAppStylesheet'
  var APP_STYLESHEET_PATH = '/ui/modules/apps/RaceTicker/app.css'
  var APP_REFRESH_INTERVAL_MS = 500
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
    link: function (scope, element) {
      var ctrl = scope.raceTicker
      refreshAppStylesheet()
      ctrl.bindRootElement(element[0])
      ctrl.initialLoad()

      var pollPromise = $interval(function () {
        ctrl.refresh()
      }, APP_REFRESH_INTERVAL_MS)

      scope.$on('$destroy', function () {
        $interval.cancel(pollPromise)
        ctrl.disposeAnimationResources()
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
      var OUT_GRACE_SECONDS = 15
      var OUT_PROGRESS_EPSILON = 0.2
      var OUT_SPEED_THRESHOLD = 2
      var START_REORDER_PAUSE_MS = 5000
      var START_RESET_MAX_LEADER_TIME = 3
      var START_RESET_DROP_THRESHOLD = 2
      var PASS_CHECK_INTERVAL_MS = 1000
      var PASS_STABLE_MS = 450
      var PASS_COOLDOWN_MS = 700
      var PASS_FORCE_COMMIT_MS = 1400
      var LAYOUT_LOCK_MS = 360
      var PASS_ANIMATION_DURATION_MULTIPLIER = 1 / 0.67
      var PASS_ANIMATION_DURATION_MS = 440
      var PASS_ANIMATION_MAX_MS = 960
      var PASS_ANIMATION_EASING = 'cubic-bezier(0.22, 0.86, 0.28, 1)'
      var PASS_UP_ANIMATION_EASING = 'cubic-bezier(0.22, 0.82, 0.24, 1)'
      var PASS_DOWN_ANIMATION_EASING = 'cubic-bezier(0.16, 0.90, 0.24, 1)'
      var vm = this
      vm.loading = false
      vm.nameRequests = {}
      vm.vehicleNames = {}
      vm.vehicleNumbers = {}
      vm.carColorsByNumber = {}
      vm.vehiclesById = {}
      vm.outSequenceCounter = 0
      vm.jumpCounter = 0
      vm.rootElement = null
      vm.passAnimation = {
        raf1: 0,
        raf2: 0,
        active: [],
        ghosts: [],
        hiddenRows: {},
        prepBoard: null
      }
      vm.orderState = {
        displayKey: '',
        displayOrder: [],
        candidateKey: '',
        candidateSinceMs: 0,
        mismatchSinceMs: 0,
        startPauseUntilMs: 0,
        hadRows: false,
        lastLeaderSortTime: null,
        cooldownUntilMs: 0,
        layoutLockUntilMs: 0,
        nextCheckMs: 0
      }
      vm.ui = {
        settingsOpen: false,
        scaleInput: '100'
      }
      vm.lineErrorToleranceSteps = LINE_ERROR_TOLERANCE_OPTIONS.slice()
      vm.settings = {
        showFuel: false,
        showLapsDown: DEFAULT_SHOW_LAPS_DOWN,
        relativeGap: DEFAULT_RELATIVE_GAP,
        showCarNumberBoxes: DEFAULT_SHOW_CAR_NUMBER_BOXES,
        useCsvCarColors: DEFAULT_USE_CSV_CAR_COLORS,
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
        var localUiConfig = readLocalUiConfig()
        applyUiConfig(localUiConfig)
        bngApi.engineLua('extensions.load("raceTickerScriptAI")')
        requestSavedUiConfig(localUiConfig)
        vm.refresh()
      }

      vm.bindRootElement = function (element) {
        vm.rootElement = element || null
      }

      vm.disposeAnimationResources = function () {
        stopPassAnimations()
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
        stopPassAnimations()
        var now = Date.now()
        vm.orderState.layoutLockUntilMs = now + LAYOUT_LOCK_MS
        vm.orderState.nextCheckMs = Math.max(vm.orderState.nextCheckMs || 0, now + PASS_CHECK_INTERVAL_MS)
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

      vm.setGapDisplayMode = function (useRelativeGap) {
        vm.settings.relativeGap = !!useRelativeGap
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

      vm.onScaleInputKeydown = function ($event) {
        if (!$event || $event.key !== 'Enter') {
          return
        }

        vm.applyScaleInput()
        if (typeof $event.preventDefault === 'function') {
          $event.preventDefault()
        }
      }

      vm.applyScaleInput = function () {
        var parsedScale = parseUiScaleInput(vm.ui.scaleInput, vm.settings.uiScale)
        vm.settings.uiScale = parsedScale
        vm.ui.scaleInput = formatUiScaleInput(parsedScale)
        persistUiConfig()
      }

      vm.scaleLabel = function () {
        return formatUiScaleInput(vm.settings.uiScale) + '%'
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
        var scale = normalizeUiScale(vm.settings.uiScale)
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
        return sanitizeSeriesText(vm.settings.seriesText, { allowEmpty: true })
      }

      vm.bannerLabel = function () {
        if (vm.state.rows.length > 0 && vm.state.totalLaps > 0) {
          return ('Lap ' + vm.state.leaderLap + ' / ' + vm.state.totalLaps).toUpperCase()
        }

        if (vm.state.manualLapCount > 0) {
          return (vm.state.manualLapCount + ' Laps').toUpperCase()
        }

        return 'ScriptAI Timing'
      }

      vm.sourceLabel = function () {
        return vm.state.rows.length > 0 ? 'Live' : 'Standby'
      }

      vm.displayName = function (name) {
        return String(name || '').toUpperCase()
      }

      vm.getCarNumberStyle = function (row) {
        if (!row || !vm.settings.useCsvCarColors || !row.carColorRgb) {
          return null
        }

        var textColor = getBadgeTextColor(row.carColorRgb)
        var textShadow = textColor.indexOf('15, 18, 28') !== -1
          ? '0 1px 1px rgba(255, 255, 255, 0.28)'
          : '0 1px 1px rgba(0, 0, 0, 0.38)'

        return {
          background:
            'linear-gradient(168deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.06) 34%, rgba(255, 255, 255, 0.00) 56%), ' +
            'linear-gradient(180deg, rgba(0, 0, 0, 0.00), rgba(0, 0, 0, 0.20)), ' +
            'rgb(' + row.carColorRgb + ')',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 -1px 0 rgba(0, 0, 0, 0.26), 0 1px 2px rgba(0, 0, 0, 0.12)',
          color: textColor,
          textShadow: textShadow
        }
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

      function requestSavedUiConfig(localUiConfig) {
        bngApi.engineLua(
          '(function() if not extensions.raceTickerScriptAI then extensions.load("raceTickerScriptAI") end return extensions.raceTickerScriptAI and extensions.raceTickerScriptAI.getUiConfig and extensions.raceTickerScriptAI.getUiConfig() or nil end)()',
          function (config) {
            $scope.$evalAsync(function () {
              applyUiConfig(mergeUiConfig(config, localUiConfig))
              persistUiConfig()
              vm.refresh()
            })
          }
        )
      }

      function mergeUiConfig(primaryConfig, overrideConfig) {
        var merged = {}

        if (primaryConfig && typeof primaryConfig === 'object') {
          angular.extend(merged, primaryConfig)
        }

        if (overrideConfig && typeof overrideConfig === 'object') {
          angular.extend(merged, overrideConfig)
        }

        return merged
      }

      function applyState(payload) {
        var now = Date.now()
        var scriptState = normalizeLuaObject(payload.scriptState)
        var fuelData = normalizeLuaObject(payload.fuelData)
        var speedData = normalizeLuaObject(payload.speedData)
        var carColors = normalizeLuaObject(payload.carColors)
        var playerVehId = parseInteger(payload.playerVehId)
        var lineErrorTolerance = getLineErrorTolerance(vm.settings.lineErrorTolerance)
        var lineEnd = 0
        var seenVehIds = {}
        var previousRowsByVehId = {}

        angular.forEach(vm.state.rows || [], function (previousRow) {
          if (!previousRow || previousRow.vehId === undefined || previousRow.vehId === null) {
            return
          }

          previousRowsByVehId[previousRow.vehId] = previousRow
        })

        updateCarColors(carColors)

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

          ensureVehicleIdentity(vehId)
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
              out: false,
              outSequence: 0,
              scriptTimeAtSave: scriptTime,
              realTimeAtSave: now,
              stallScriptTimeAtSave: scriptTime,
              stallRealTimeAtSave: now,
              outScriptTimeAtSave: scriptTime,
              outRealTimeAtSave: now,
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
            entry.out = false
            entry.outSequence = 0
            entry.storedScriptTime = scriptTime
            entry.scriptTimeAtSave = scriptTime
            entry.realTimeAtSave = now
            entry.stallScriptTimeAtSave = scriptTime
            entry.stallRealTimeAtSave = now
            entry.outScriptTimeAtSave = scriptTime
            entry.outRealTimeAtSave = now
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

          updateOutState(entry, scriptTime, now)
          updateStallState(entry, scriptTime, now)
        })

        angular.forEach(vm.vehiclesById, function (entry, vehId) {
          if (!seenVehIds[vehId]) {
            delete vm.vehiclesById[vehId]
            delete vm.vehicleNames[vehId]
            delete vm.vehicleNumbers[vehId]
            delete vm.nameRequests[vehId]
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
            stalled: entry.stalled,
            out: entry.out,
            outSequence: entry.outSequence
          })
        })

        rows.sort(function (left, right) {
          if (!!left.out !== !!right.out) {
            return left.out ? 1 : -1
          }

          if (left.out && right.out) {
            if (left.outSequence !== right.outSequence) {
              return right.outSequence - left.outSequence
            }

            return left.vehId - right.vehId
          }

          if (left.sortTime !== right.sortTime) {
            return right.sortTime - left.sortTime
          }

          return left.vehId - right.vehId
        })

        angular.forEach(rows, function (row, index) {
          row.name = getVehicleName(row.vehId)
          row.fuelLabel = formatFuelLabel(row.fuel)
          row.isPlayerFocus = playerVehId !== null && playerVehId === row.vehId
          row.isOut = !!row.out
          row.isWarning = row.crashed || row.jumped || row.stalled || row.isOut
        })

        var didStartPauseWindow = updateRunStartPause(rows, now)
        if (didStartPauseWindow) {
          previousRowsByVehId = {}
        }
        var displayResolution = resolveDisplayRows(rows, now)
        rows = displayResolution.rows

        var totalLaps = Math.max(toNumber(vm.state.manualLapCount, 0), 0)
        var lapLength = totalLaps > 0 && lineEnd > 0 ? lineEnd / totalLaps : 0
        var leaderTime = rows.length > 0 ? rows[0].sortTime : 0
        var leaderLap = lapLength > 0 ? clampLeaderLap(Math.floor(leaderTime / lapLength) + 1, totalLaps) : 0

        var pauseGapUpdates = now < vm.orderState.startPauseUntilMs
        angular.forEach(rows, function (row, index) {
          row.position = index + 1
          row.carNumber = getVehicleNumber(row.vehId)
          row.carColorHex = getCarColorForNumber(row.carNumber)
          row.carColorRgb = hexColorToRgb(row.carColorHex)
          if (pauseGapUpdates && previousRowsByVehId[row.vehId] && previousRowsByVehId[row.vehId].gapLabel) {
            row.gapLabel = previousRowsByVehId[row.vehId].gapLabel
          } else {
            row.gapLabel = buildGapLabel(rows, index, lapLength, totalLaps, lineEnd)
          }
          row.isLeader = index === 0
        })

        vm.state.totalLaps = totalLaps
        vm.state.leaderLap = leaderLap
        vm.state.lineEnd = rows.length > 0 ? lineEnd : 0
        vm.state.rows = rows
        vm.state.statusText = rows.length > 0
          ? 'Select a row to jump to that car.'
          : 'Start a ScriptAI line in Script AI Manager to populate the ticker.'

        if (displayResolution.shouldAnimate && displayResolution.previousGeometry) {
          schedulePassAnimation(displayResolution.previousGeometry)
        }
      }

      function buildGapLabel(rows, index, lapLength, totalLaps, lineEnd) {
        if (!rows[index]) {
          return '--'
        }

        var leader = rows[0]
        var row = rows[index]
        if (row.isOut) {
          return 'OUT'
        }

        if (index === 0) {
          if (vm.settings.showLapsDown) {
            return 'Leader'
          }

          if (lineEnd > 0) {
            return Math.max(Math.round((1 - (leader.sortTime / lineEnd)) * 100), 0) + '% left'
          }

          return 'Leader'
        }

        var anchorRow = vm.settings.relativeGap ? rows[index - 1] : leader
        if (!anchorRow) {
          anchorRow = leader
        }

        if (vm.settings.relativeGap && lapLength > 0) {
          var leaderTimeBehind = Math.max(toNumber(leader.sortTime, 0) - toNumber(row.sortTime, 0), 0)
          var lapsBehindLeader = Math.floor(leaderTimeBehind / lapLength)
          if (lapsBehindLeader > 0) {
            return '+' + lapsBehindLeader + ' ' + (lapsBehindLeader === 1 ? 'Lap' : 'Laps')
          }
        }

        var timeBehind = Math.max(toNumber(anchorRow.sortTime, 0) - toNumber(row.sortTime, 0), 0)

        return '+' + timeBehind.toFixed(2)
      }

      function updateOutState(entry, scriptTime, now) {
        if (entry.out) {
          return
        }

        var isCrashState = entry.crashed || entry.jumped
        var progressDelta = scriptTime - toNumber(entry.outScriptTimeAtSave, scriptTime)
        var noProgressDuration = (now - toNumber(entry.outRealTimeAtSave, now)) / 1000
        var isMoving = toNumber(entry.speed, 0) > OUT_SPEED_THRESHOLD

        if (!isCrashState || progressDelta > OUT_PROGRESS_EPSILON || isMoving) {
          entry.outScriptTimeAtSave = scriptTime
          entry.outRealTimeAtSave = now
          return
        }

        if (noProgressDuration >= OUT_GRACE_SECONDS && !entry.out) {
          vm.outSequenceCounter = vm.outSequenceCounter + 1
          entry.outSequence = vm.outSequenceCounter
          entry.out = true
        }
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

      function updateRunStartPause(rows, now) {
        var hasRows = !!(rows && rows.length)
        var leaderSortTime = hasRows ? toNumber(rows[0].sortTime, 0) : null
        var previousLeaderSortTime = toNumber(vm.orderState.lastLeaderSortTime, null)
        var isFreshStart = hasRows && !vm.orderState.hadRows
        var isRunReset = false
        var didStartPauseWindow = false

        if (hasRows && previousLeaderSortTime !== null && leaderSortTime !== null) {
          isRunReset = leaderSortTime <= START_RESET_MAX_LEADER_TIME &&
            (previousLeaderSortTime - leaderSortTime) >= START_RESET_DROP_THRESHOLD
        }

        if (isFreshStart || isRunReset) {
          vm.outSequenceCounter = 0
          vm.orderState.startPauseUntilMs = now + START_REORDER_PAUSE_MS
          vm.orderState.candidateKey = ''
          vm.orderState.candidateSinceMs = 0
          vm.orderState.mismatchSinceMs = 0
          vm.orderState.cooldownUntilMs = 0
          vm.orderState.nextCheckMs = now + PASS_CHECK_INTERVAL_MS
          didStartPauseWindow = true
        }

        vm.orderState.hadRows = hasRows
        vm.orderState.lastLeaderSortTime = hasRows ? leaderSortTime : null
        return didStartPauseWindow
      }

      function resolveDisplayRows(canonicalRows, now) {
        var canonicalKey = buildOrderKey(canonicalRows)
        var displayedRows = mapRowsToDisplayOrder(canonicalRows, vm.orderState.displayOrder)
        var displayKey = buildOrderKey(displayedRows)
        var isFirstRender = !displayKey
        var hasSetChange = !isFirstRender && !hasSameVehSet(displayedRows, canonicalRows)

        if (isFirstRender || hasSetChange) {
          vm.orderState.displayOrder = extractVehIds(canonicalRows)
          vm.orderState.displayKey = canonicalKey
          vm.orderState.candidateKey = ''
          vm.orderState.candidateSinceMs = 0
          vm.orderState.mismatchSinceMs = 0
          vm.orderState.nextCheckMs = now + PASS_CHECK_INTERVAL_MS
          return {
            rows: canonicalRows,
            shouldAnimate: false,
            previousGeometry: null
          }
        }

        if (canonicalKey === displayKey) {
          vm.orderState.displayOrder = extractVehIds(displayedRows)
          vm.orderState.displayKey = displayKey
          vm.orderState.candidateKey = ''
          vm.orderState.candidateSinceMs = 0
          vm.orderState.mismatchSinceMs = 0
          vm.orderState.nextCheckMs = now + PASS_CHECK_INTERVAL_MS
          return {
            rows: displayedRows,
            shouldAnimate: false,
            previousGeometry: null
          }
        }

        if (now < vm.orderState.startPauseUntilMs) {
          return {
            rows: displayedRows,
            shouldAnimate: false,
            previousGeometry: null
          }
        }

        if (now < vm.orderState.nextCheckMs) {
          return {
            rows: displayedRows,
            shouldAnimate: false,
            previousGeometry: null
          }
        }
        vm.orderState.nextCheckMs = now + PASS_CHECK_INTERVAL_MS

        if (isPassAnimationBusy()) {
          return {
            rows: displayedRows,
            shouldAnimate: false,
            previousGeometry: null
          }
        }

        var layoutLocked = now < vm.orderState.layoutLockUntilMs
        var cooldownLocked = now < vm.orderState.cooldownUntilMs
        if (layoutLocked || cooldownLocked) {
          return {
            rows: displayedRows,
            shouldAnimate: false,
            previousGeometry: null
          }
        }

        var previousGeometry = captureBoardRowGeometry()
        vm.orderState.displayOrder = extractVehIds(canonicalRows)
        vm.orderState.displayKey = canonicalKey
        vm.orderState.candidateKey = ''
        vm.orderState.candidateSinceMs = 0
        vm.orderState.mismatchSinceMs = 0
        var shouldAnimate = !!previousGeometry
        if (shouldAnimate) {
          vm.orderState.cooldownUntilMs = now + PASS_COOLDOWN_MS
        }

        return {
          rows: canonicalRows,
          shouldAnimate: shouldAnimate,
          previousGeometry: previousGeometry
        }
      }

      function buildOrderKey(rows) {
        if (!rows || !rows.length) {
          return ''
        }

        var ids = []
        angular.forEach(rows, function (row) {
          if (!row || row.vehId === undefined || row.vehId === null) {
            return
          }

          ids.push(String(row.vehId))
        })

        return ids.join('|')
      }

      function extractVehIds(rows) {
        var ids = []
        angular.forEach(rows || [], function (row) {
          if (!row || row.vehId === undefined || row.vehId === null) {
            return
          }

          ids.push(row.vehId)
        })

        return ids
      }

      function mapRowsToDisplayOrder(canonicalRows, displayOrder) {
        var rowsByVehId = {}
        var orderedRows = []

        angular.forEach(canonicalRows || [], function (row) {
          if (!row || row.vehId === undefined || row.vehId === null) {
            return
          }

          rowsByVehId[String(row.vehId)] = row
        })

        angular.forEach(displayOrder || [], function (vehId) {
          var key = String(vehId)
          if (!rowsByVehId[key]) {
            return
          }

          orderedRows.push(rowsByVehId[key])
          delete rowsByVehId[key]
        })

        angular.forEach(canonicalRows || [], function (row) {
          var key
          if (!row || row.vehId === undefined || row.vehId === null) {
            return
          }

          key = String(row.vehId)
          if (!rowsByVehId[key]) {
            return
          }

          orderedRows.push(rowsByVehId[key])
          delete rowsByVehId[key]
        })

        return orderedRows
      }

      function hasSameVehSet(leftRows, rightRows) {
        var counts = {}
        var key

        if ((leftRows || []).length !== (rightRows || []).length) {
          return false
        }

        angular.forEach(leftRows || [], function (row) {
          if (!row || row.vehId === undefined || row.vehId === null) {
            return
          }

          key = String(row.vehId)
          counts[key] = (counts[key] || 0) + 1
        })

        angular.forEach(rightRows || [], function (row) {
          if (!row || row.vehId === undefined || row.vehId === null) {
            return
          }

          key = String(row.vehId)
          if (!counts[key]) {
            counts.__missing = true
            return
          }

          counts[key] = counts[key] - 1
        })

        if (counts.__missing) {
          return false
        }

        for (key in counts) {
          if (!Object.prototype.hasOwnProperty.call(counts, key) || key === '__missing') {
            continue
          }

          if (counts[key] !== 0) {
            return false
          }
        }

        return true
      }

      function buildReorderCandidateKey(displayRows, canonicalRows) {
        var maxLength = Math.max((displayRows || []).length, (canonicalRows || []).length)
        var index

        for (index = 0; index < maxLength; index++) {
          var displayRow = displayRows[index]
          var canonicalRow = canonicalRows[index]
          var displayVehId = displayRow && displayRow.vehId !== undefined && displayRow.vehId !== null ? String(displayRow.vehId) : ''
          var canonicalVehId = canonicalRow && canonicalRow.vehId !== undefined && canonicalRow.vehId !== null ? String(canonicalRow.vehId) : ''

          if (displayVehId === canonicalVehId) {
            continue
          }

          var displayNext = displayRows[index + 1]
          var canonicalNext = canonicalRows[index + 1]
          var displayNextVehId = displayNext && displayNext.vehId !== undefined && displayNext.vehId !== null ? String(displayNext.vehId) : ''
          var canonicalNextVehId = canonicalNext && canonicalNext.vehId !== undefined && canonicalNext.vehId !== null ? String(canonicalNext.vehId) : ''
          return index + ':' + canonicalVehId + ':' + displayVehId + ':' + canonicalNextVehId + ':' + displayNextVehId
        }

        return buildOrderKey(canonicalRows)
      }

      function isPassAnimationBusy() {
        return !!(
          vm.passAnimation.raf1 ||
          vm.passAnimation.raf2 ||
          (vm.passAnimation.active && vm.passAnimation.active.length) ||
          (vm.passAnimation.ghosts && vm.passAnimation.ghosts.length)
        )
      }

      function captureBoardRowGeometry() {
        if (!vm.rootElement || typeof window === 'undefined') {
          return null
        }

        var boardElement = vm.rootElement.querySelector('.board')
        if (!boardElement) {
          return null
        }

        var passLayer = boardElement.querySelector('.board-pass-layer')
        if (!passLayer) {
          return null
        }

        var boardRect = boardElement.getBoundingClientRect()
        var rowElements = boardElement.querySelectorAll('.board-row[data-veh-id]')
        var rowsByVehId = {}

        angular.forEach(rowElements, function (rowElement) {
          var vehId = rowElement.getAttribute('data-veh-id')
          var rowRect
          if (!vehId) {
            return
          }

          rowRect = rowElement.getBoundingClientRect()
          rowsByVehId[vehId] = {
            top: rowRect.top - boardRect.top + boardElement.scrollTop,
            left: rowRect.left - boardRect.left + boardElement.scrollLeft,
            width: rowRect.width,
            height: rowRect.height
          }
        })

        return {
          boardElement: boardElement,
          passLayer: passLayer,
          rowsByVehId: rowsByVehId
        }
      }

      function schedulePassAnimation(previousGeometry) {
        if (!previousGeometry || !previousGeometry.boardElement || !previousGeometry.passLayer || typeof window === 'undefined') {
          return
        }

        stopPassAnimations()

        previousGeometry.boardElement.classList.add('is-pass-anim-prep')
        vm.passAnimation.prepBoard = previousGeometry.boardElement

        vm.passAnimation.raf1 = window.requestAnimationFrame(function () {
          vm.passAnimation.raf1 = 0
          playPassAnimation(previousGeometry)
        })
      }

      function playPassAnimation(previousGeometry) {
        var boardElement = previousGeometry.boardElement
        var passLayer = previousGeometry.passLayer
        var boardRect
        var rowElements
        var moveEntries = []
        var maxDistance = 0

        if (!boardElement || !passLayer) {
          return
        }

        boardRect = boardElement.getBoundingClientRect()
        rowElements = boardElement.querySelectorAll('.board-row[data-veh-id]')

        angular.forEach(rowElements, function (rowElement) {
          var vehId = rowElement.getAttribute('data-veh-id')
          var previousRow = previousGeometry.rowsByVehId[vehId]
          var currentRect
          var currentTop
          var deltaY

          if (!vehId || !previousRow) {
            return
          }

          currentRect = rowElement.getBoundingClientRect()
          currentTop = currentRect.top - boardRect.top + boardElement.scrollTop
          deltaY = Math.round(currentTop - previousRow.top)
          if (Math.abs(deltaY) < 1) {
            return
          }

          moveEntries.push({
            vehId: vehId,
            rowElement: rowElement,
            previousRow: previousRow,
            deltaY: deltaY,
            distance: Math.abs(deltaY),
            isDown: deltaY > 0
          })
        })

        if (!moveEntries.length) {
          clearPassPrepVisibility()
          return
        }

        angular.forEach(moveEntries, function (entry) {
          if (entry.distance > maxDistance) {
            maxDistance = entry.distance
          }
        })

        var baseDuration = Math.max(
          PASS_ANIMATION_DURATION_MS,
          Math.min(PASS_ANIMATION_MAX_MS, Math.round(300 + maxDistance * 1.7))
        )
        var maxDuration = Math.round(PASS_ANIMATION_MAX_MS * PASS_ANIMATION_DURATION_MULTIPLIER)
        var upDuration = Math.min(maxDuration, Math.round(baseDuration * PASS_ANIMATION_DURATION_MULTIPLIER))
        var downDuration = Math.min(maxDuration, upDuration + Math.round(120 * PASS_ANIMATION_DURATION_MULTIPLIER))

        angular.forEach(moveEntries, function (entry) {
          var ghostNode = entry.rowElement.cloneNode(true)
          var animation
          var easing = entry.isDown ? PASS_DOWN_ANIMATION_EASING : PASS_UP_ANIMATION_EASING
          var duration = entry.isDown ? downDuration : upDuration

          hideLiveRow(entry.vehId, entry.rowElement)

          ghostNode.classList.add('board-row-ghost')
          ghostNode.style.position = 'absolute'
          ghostNode.style.pointerEvents = 'none'
          ghostNode.style.visibility = 'visible'
          ghostNode.style.marginTop = '0'
          ghostNode.style.top = entry.previousRow.top + 'px'
          ghostNode.style.left = entry.previousRow.left + 'px'
          ghostNode.style.width = entry.previousRow.width + 'px'
          ghostNode.style.height = entry.previousRow.height + 'px'
          ghostNode.style.zIndex = entry.isDown ? '8' : '6'
          ghostNode.style.transform = 'translate3d(0, 0, 0)'
          passLayer.appendChild(ghostNode)
          vm.passAnimation.ghosts.push(ghostNode)

          if (!ghostNode.animate) {
            ghostNode.style.transition = 'transform ' + duration + 'ms ' + easing
            ghostNode.style.transform = 'translate3d(0, ' + entry.deltaY.toFixed(2) + 'px, 0)'
            window.setTimeout(function () {
              removePassGhostNode(ghostNode)
            }, duration + 50)
            return
          }

          animation = ghostNode.animate(
            [
              { transform: 'translate3d(0, 0, 0)' },
              { transform: 'translate3d(0, ' + entry.deltaY.toFixed(2) + 'px, 0)' }
            ],
            {
              duration: duration,
              easing: easing,
              fill: 'forwards'
            }
          )

          animation.onfinish = function () {
            removePassAnimation(animation)
            removePassGhostNode(ghostNode)
          }

          animation.oncancel = function () {
            removePassAnimation(animation)
            removePassGhostNode(ghostNode)
          }

          vm.passAnimation.active.push(animation)
        })

        clearPassPrepVisibility()
      }

      function removePassAnimation(animation) {
        var index = vm.passAnimation.active.indexOf(animation)
        if (index !== -1) {
          vm.passAnimation.active.splice(index, 1)
        }
      }

      function clearPassPrepVisibility() {
        if (vm.passAnimation.prepBoard && vm.passAnimation.prepBoard.classList) {
          vm.passAnimation.prepBoard.classList.remove('is-pass-anim-prep')
        }
        vm.passAnimation.prepBoard = null
      }

      function hideLiveRow(vehId, rowElement) {
        var key
        if (!rowElement || vehId === undefined || vehId === null) {
          return
        }

        key = String(vehId)
        if (vm.passAnimation.hiddenRows[key]) {
          return
        }

        vm.passAnimation.hiddenRows[key] = {
          element: rowElement,
          visibility: rowElement.style.visibility || ''
        }
        rowElement.style.visibility = 'hidden'
      }

      function restoreLiveRow(vehId) {
        var key = String(vehId)
        var hiddenEntry = vm.passAnimation.hiddenRows[key]
        if (!hiddenEntry) {
          return
        }

        if (hiddenEntry.element) {
          hiddenEntry.element.style.visibility = hiddenEntry.visibility || ''
        }
        delete vm.passAnimation.hiddenRows[key]
      }

      function restoreAllHiddenRows() {
        angular.forEach(vm.passAnimation.hiddenRows, function (hiddenEntry, key) {
          if (hiddenEntry && hiddenEntry.element) {
            hiddenEntry.element.style.visibility = hiddenEntry.visibility || ''
          }
          delete vm.passAnimation.hiddenRows[key]
        })
      }

      function removePassGhostNode(ghostNode) {
        var index = vm.passAnimation.ghosts.indexOf(ghostNode)
        var vehId
        if (index !== -1) {
          vm.passAnimation.ghosts.splice(index, 1)
        }

        vehId = ghostNode && ghostNode.getAttribute ? ghostNode.getAttribute('data-veh-id') : null
        if (vehId) {
          restoreLiveRow(vehId)
        }

        if (ghostNode && ghostNode.parentNode) {
          ghostNode.parentNode.removeChild(ghostNode)
        }
      }

      function stopPassAnimations() {
        if (typeof window !== 'undefined' && vm.passAnimation.raf1) {
          window.cancelAnimationFrame(vm.passAnimation.raf1)
          vm.passAnimation.raf1 = 0
        }

        if (typeof window !== 'undefined' && vm.passAnimation.raf2) {
          window.cancelAnimationFrame(vm.passAnimation.raf2)
          vm.passAnimation.raf2 = 0
        }

        angular.forEach(vm.passAnimation.active, function (animation) {
          if (!animation || typeof animation.cancel !== 'function') {
            return
          }

          try {
            animation.cancel()
          } catch (error) {
            return
          }
        })
        vm.passAnimation.active = []

        angular.forEach(vm.passAnimation.ghosts, function (ghostNode) {
          if (ghostNode && ghostNode.parentNode) {
            ghostNode.parentNode.removeChild(ghostNode)
          }
        })
        vm.passAnimation.ghosts = []
        restoreAllHiddenRows()
        clearPassPrepVisibility()
      }

      function ensureVehicleIdentity(vehId) {
        if (vehId === null || vm.nameRequests[vehId]) {
          return
        }

        if (vm.vehicleNames[vehId] !== undefined && vm.vehicleNumbers[vehId] !== undefined) {
          return
        }

        vm.nameRequests[vehId] = true
        bngApi.engineLua(
          '(function() ' +
            'local vehId = ' + vehId + '; ' +
            'local obj = scenetree.findObject(vehId); ' +
            'if not obj then return { name = "", modFilename = "" } end; ' +
            'local model = (obj.getJBeamFilename and obj:getJBeamFilename()) or ""; ' +
            'local function appendCandidate(candidates, seen, value) ' +
              'if type(value) == "string" and value ~= "" and not seen[value] then ' +
                'seen[value] = true; ' +
                'table.insert(candidates, value); ' +
              'end; ' +
            'end; ' +
            'local function findModFilename() ' +
              'local modExt = extensions and extensions.core_modmanager; ' +
              'if not modExt or not modExt.getModFromPath then return "" end; ' +
              'local candidates = {}; ' +
              'local seen = {}; ' +
              'local bundleExt = extensions and extensions.core_vehicle_manager; ' +
              'local bundle = bundleExt and bundleExt.getVehicleData and bundleExt.getVehicleData(vehId) or nil; ' +
              'local vdata = bundle and bundle.vdata or nil; ' +
              'local vehicleDir = type(vdata and vdata.vehicleDirectory) == "string" and vdata.vehicleDirectory or ""; ' +
              'local mainPartName = type(vdata and vdata.mainPartName) == "string" and vdata.mainPartName or model; ' +
              'if vehicleDir ~= "" then ' +
                'if string.sub(vehicleDir, -1) ~= "/" then vehicleDir = vehicleDir .. "/" end; ' +
                'appendCandidate(candidates, seen, vehicleDir .. "info.json"); ' +
                'appendCandidate(candidates, seen, vehicleDir .. mainPartName .. ".jbeam"); ' +
                'appendCandidate(candidates, seen, vehicleDir .. model .. ".jbeam"); ' +
                'if FS and FS.findFiles then ' +
                  'local jbeamFiles = FS:findFiles(vehicleDir, "*.jbeam", -1, false, false); ' +
                  'if type(jbeamFiles) == "table" then ' +
                    'for fileIndex = 1, math.min(#jbeamFiles, 6) do ' +
                      'appendCandidate(candidates, seen, jbeamFiles[fileIndex]); ' +
                    'end; ' +
                  'end; ' +
                'end; ' +
              'end; ' +
              'if type(model) == "string" and model ~= "" then ' +
                'appendCandidate(candidates, seen, "/vehicles/" .. model .. "/info.json"); ' +
                'appendCandidate(candidates, seen, "/vehicles/" .. model .. "/" .. model .. ".jbeam"); ' +
              'end; ' +
              'for _, candidatePath in ipairs(candidates) do ' +
                'local mod = modExt.getModFromPath(candidatePath); ' +
                'if mod then ' +
                  'return tostring(mod.filename or mod.fullpath or mod.modname or ""); ' +
                'end; ' +
              'end; ' +
              'return ""; ' +
            'end; ' +
            'return { name = model, modFilename = findModFilename() }; ' +
          'end)()',
          function (info) {
            $scope.$evalAsync(function () {
              var payload = info && typeof info === 'object' ? info : {}
              vm.vehicleNames[vehId] = simplifyVehicleName(payload.name, vehId)
              vm.vehicleNumbers[vehId] = extractCarNumber(payload.modFilename)
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

      function getVehicleNumber(vehId) {
        if (vm.vehicleNumbers[vehId] !== undefined) {
          return vm.vehicleNumbers[vehId]
        }

        return '000'
      }

      function extractCarNumber(modFilename) {
        var value = String(modFilename || '')
        value = value.replace(/\\/g, '/')
        value = value.replace(/^.*\//, '')
        var match = value.match(/^(\d{1,3})-/)
        if (!match) {
          return '000'
        }

        return match[1]
      }

      function updateCarColors(rawColors) {
        var normalizedColors = {}

        angular.forEach(rawColors, function (rawColor, rawNumber) {
          var numberKey = normalizeCarNumberKey(rawNumber)
          var hexColor = normalizeHexColor(rawColor)
          if (!numberKey || !hexColor) {
            return
          }

          normalizedColors[numberKey] = hexColor
        })

        vm.carColorsByNumber = normalizedColors
      }

      function getCarColorForNumber(carNumber) {
        var numberKey = normalizeCarNumberKey(carNumber)
        if (!numberKey) {
          return ''
        }

        return vm.carColorsByNumber[numberKey] || ''
      }

      function normalizeCarNumberKey(value) {
        var numericValue = parseInteger(value)
        if (numericValue === null || numericValue < 0) {
          return ''
        }

        return String(numericValue)
      }

      function normalizeHexColor(value) {
        var text = String(value == null ? '' : value).trim()
        if (!text) {
          return ''
        }

        if (text.charAt(0) === '#') {
          text = text.slice(1)
        }

        if (/^[0-9a-fA-F]{3}$/.test(text)) {
          text = text.charAt(0) + text.charAt(0) +
            text.charAt(1) + text.charAt(1) +
            text.charAt(2) + text.charAt(2)
        }

        if (!/^[0-9a-fA-F]{6}$/.test(text)) {
          return ''
        }

        return '#' + text.toUpperCase()
      }

      function hexColorToRgb(hexColor) {
        var normalizedHex = normalizeHexColor(hexColor)
        if (!normalizedHex) {
          return ''
        }

        var red = parseInt(normalizedHex.slice(1, 3), 16)
        var green = parseInt(normalizedHex.slice(3, 5), 16)
        var blue = parseInt(normalizedHex.slice(5, 7), 16)
        if (!isFinite(red) || !isFinite(green) || !isFinite(blue)) {
          return ''
        }

        return red + ', ' + green + ', ' + blue
      }

      function getBadgeTextColor(rgbString) {
        var parts = String(rgbString || '').split(',')
        if (parts.length < 3) {
          return 'rgba(248, 252, 255, 0.98)'
        }

        var red = toNumber(parts[0], 0)
        var green = toNumber(parts[1], 0)
        var blue = toNumber(parts[2], 0)
        var luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722)

        if (luminance >= 165) {
          return 'rgba(15, 18, 28, 0.94)'
        }

        return 'rgba(248, 252, 255, 0.98)'
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
        vm.settings.relativeGap = config.relativeGap === undefined ? DEFAULT_RELATIVE_GAP : !!config.relativeGap
        vm.settings.showCarNumberBoxes = config.showCarNumberBoxes === undefined ? DEFAULT_SHOW_CAR_NUMBER_BOXES : !!config.showCarNumberBoxes
        vm.settings.useCsvCarColors = config.useCsvCarColors === undefined ? DEFAULT_USE_CSV_CAR_COLORS : !!config.useCsvCarColors
        vm.settings.uiScale = normalizeUiScale(config.uiScale)
        vm.ui.scaleInput = formatUiScaleInput(vm.settings.uiScale)
        vm.settings.seriesText = sanitizeSeriesText(config.seriesText, { allowEmpty: true })
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
          relativeGap: !!vm.settings.relativeGap,
          showCarNumberBoxes: !!vm.settings.showCarNumberBoxes,
          useCsvCarColors: !!vm.settings.useCsvCarColors,
          uiScale: normalizeUiScale(vm.settings.uiScale),
          seriesText: sanitizeSeriesText(vm.settings.seriesText, { allowEmpty: true }),
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

      function sanitizeSeriesText(value, options) {
        var allowEmpty = !!(options && options.allowEmpty)
        var hasValue = value !== undefined && value !== null
        var text = hasValue ? String(value) : ''
        text = text.replace(/\s+/g, ' ').trim()
        if (!text) {
          if (allowEmpty && hasValue) {
            return ''
          }

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
        var numericScale = normalizeUiScale(scale)
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

      function normalizeUiScale(scale) {
        var numericScale = toNumber(scale, 1)
        if (!isFinite(numericScale) || numericScale <= 0) {
          return 1
        }

        return numericScale
      }

      function parseUiScaleInput(inputValue, fallbackScale) {
        var rawText = String(inputValue == null ? '' : inputValue).trim()
        if (!rawText) {
          return normalizeUiScale(fallbackScale)
        }

        var hasPercent = rawText.indexOf('%') !== -1
        var numericValue = toNumber(rawText.replace(/%/g, ''), null)
        if (numericValue === null || numericValue <= 0) {
          return normalizeUiScale(fallbackScale)
        }

        if (hasPercent || numericValue >= 10) {
          return numericValue / 100
        }

        return numericValue
      }

      function formatUiScaleInput(scale) {
        var percentageValue = normalizeUiScale(scale) * 100
        var roundedValue = Math.round(percentageValue * 100) / 100
        return (Math.abs(roundedValue - Math.round(roundedValue)) < 0.0001)
          ? String(Math.round(roundedValue))
          : String(roundedValue)
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

  function refreshAppStylesheet() {
    if (typeof document === 'undefined') {
      return
    }

    var head = document.head || document.getElementsByTagName('head')[0]
    var link
    if (!head) {
      return
    }

    link = document.getElementById(APP_STYLESHEET_ID)
    if (!link) {
      link = document.createElement('link')
      link.id = APP_STYLESHEET_ID
      link.rel = 'stylesheet'
      link.type = 'text/css'
      head.appendChild(link)
    }

    link.href = APP_STYLESHEET_PATH + '?v=' + Date.now()
  }
}])
