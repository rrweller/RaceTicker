angular.module('beamng.apps')
.directive('RaceTicker', ['StreamsManager', function (StreamsManager) {
  return {
    template:  '<button ng-click="hello()">Click Me</button>',
    replace: true,
    restrict: 'EA',
    link: function (scope, element, attrs) {      
      scope.hello = function () {
        // do something here.
      };
    }
	
	//Creates a Lua global table in GameEngine Lua
	bngApi.engineLua('script_state_table = {}');

	//This is called all the time
	scope.$on('streamsUpdate', function (event, streams) {
        //This calls GameEngine Lua to tell all Vehicle Luas to insert their serialized ai.scriptState() into the GameEngine Lua script_state_table
        bngApi.engineLua('be:queueAllObjectLua("obj:queueGameEngineLua(\'script_state_table[\'..obj:getID() .. \'] = \' .. serialize(ai.scriptState()))")');
       
        //This gets that script_state_table from GameEngine Lua
        bngApi.engineLua('script_state_table', function(data) {
            for (const [key, value] of Object.entries(data)) {
                var veh_id = key;
                var scriptTime = value.scriptTime;
             
                console.log("Vehicle ID: " + veh_id + ", Time: " + scriptTime);
            }
        });
	});
  };
}])