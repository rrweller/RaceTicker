angular.module('beamng.apps').directive('raceTicker', ['$interval', function ($interval) {
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
      var ERROR_TOLERANCE = 5
      var ERROR_SENSITIVITY = 5
      var JUMP_INTERVAL = 10
      var JUMP_GRACE_SECONDS = 5

      var vm = this
      vm.loading = false
      vm.nameRequests = {}
      vm.vehicleNames = {}
      vm.vehiclesById = {}
      vm.jumpCounter = 0
      vm.settings = {
        showFuel: false,
        showLapsDown: false
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
        bngApi.engineLua('extensions.load("raceTickerScriptAI")')
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
        vm.refresh()
      }

      vm.decrementManualLaps = function () {
        vm.state.manualLapCount = Math.max(vm.state.manualLapCount - 1, 0)
        vm.refresh()
      }

      vm.currentLapLabel = function () {
        if (vm.state.totalLaps > 0) {
          return 'Lap ' + vm.state.leaderLap + ' / ' + vm.state.totalLaps
        }

        if (vm.state.manualLapCount > 0) {
          return 'Lap count ' + vm.state.manualLapCount
        }

        return 'Waiting for race'
      }

      vm.sourceLabel = function () {
        return vm.state.rows.length > 0 ? 'ScriptAI' : 'No ScriptAI Data'
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

      function applyState(payload) {
        var now = toNumber(payload.timestamp, Date.now())
        var scriptState = normalizeLuaObject(payload.scriptState)
        var fuelData = normalizeLuaObject(payload.fuelData)
        var playerVehId = parseInteger(payload.playerVehId)
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
              scriptTimeAtSave: scriptTime,
              realTimeAtSave: now,
              endScriptTime: 0,
              fuel: null
            }
            vm.vehiclesById[vehId] = entry
          }

          var previousScriptTime = toNumber(entry.lastScriptTime, scriptTime)
          if (scriptTime + 1 < previousScriptTime) {
            entry.averageLineError = 0
            entry.crashed = false
            entry.jumped = false
            entry.storedScriptTime = scriptTime
            entry.scriptTimeAtSave = scriptTime
            entry.realTimeAtSave = now
            entry.endScriptTime = 0
          }

          entry.time = scriptTime
          entry.lastScriptTime = scriptTime
          entry.endScriptTime = Math.max(toNumber(value.endScriptTime, 0), entry.endScriptTime || 0)
          lineEnd = Math.max(lineEnd, entry.endScriptTime)

          var lineError = Math.abs(toNumber(value.posError, 0))
          entry.averageLineError = ((entry.averageLineError * ERROR_SENSITIVITY) + lineError) / (ERROR_SENSITIVITY + 1)

          if (entry.averageLineError > ERROR_TOLERANCE) {
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
            sortTime: entry.crashed ? (entry.jumped ? 0 : toNumber(entry.storedScriptTime, 0)) : toNumber(entry.time, 0),
            fuel: entry.fuel,
            crashed: entry.crashed,
            jumped: entry.jumped
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
          row.isWarning = row.crashed || row.jumped
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
          if (vm.settings.showLapsDown && totalLaps > 0 && lapLength > 0) {
            var lapsComplete = clampLeaderLap(Math.floor(leader.sortTime / lapLength) + 1, totalLaps)
            if (lapsComplete <= Math.floor(totalLaps * 0.5)) {
              return 'Lap ' + lapsComplete + ' of ' + totalLaps
            }
            if (lapsComplete < totalLaps) {
              return (totalLaps - lapsComplete + 1) + ' Laps to go'
            }
            return 'Final Lap'
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

      function finishRefresh(applyState) {
        $scope.$evalAsync(function () {
          applyState()
          vm.loading = false
        })
      }
    },
    controllerAs: 'raceTicker'
  }
}])
