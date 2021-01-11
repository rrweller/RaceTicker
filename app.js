angular.module('beamng.apps')
.directive('raceTicker', ['bngApi', 'StreamsManager', function (bngApi, StreamsManager) {
  return {
    template:  '<span style="font-size:1em">{{ currentTime }}</span>',
    replace: true,
    restrict: 'EA',
    link: function (scope, element, attrs) {      
		//Creates a Lua global table in GameEngine Lua
		bngApi.engineLua('script_state_table = {}');
		//This is called all the time
		scope.$on('streamsUpdate', function (event, streams) {
				//This calls GameEngine Lua to tell all Vehicle Luas to insert their serialized ai.scriptState() into the GameEngine Lua script_state_table
				bngApi.engineLua('be:queueAllObjectLua("obj:queueGameEngineLua(\'script_state_table[\'..obj:getID() .. \'] = \' .. serialize(ai.scriptState()))")');
			   
			   
				var outputText = "";
				//This gets that script_state_table from GameEngine Lua
				bngApi.engineLua('script_state_table', function(data) {
					for (const [key, value] of Object.entries(data)) {
						var veh_id = key;
						//var scriptTime = value.scriptTime;
						var scriptPercent = value.scriptTime / value.endScriptTime * 100
					 
						//console.log("Vehicle ID: " + veh_id + ", Time: " + scriptTime);
						
						outputText = outputText + "id: " + veh_id + ", progress: " + scriptPercent;
						//scope.currentTime = value;
						
					}
					scope.currentTime = outputText;
				});
				
		});

		
		//scope.currentTime = "2";
    }
  };
}])