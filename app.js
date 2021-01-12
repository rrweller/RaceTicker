var vehicles = [];
var vehiclesSorted = [];
var leaderboardFormatted= "start line to start leaderboard";
angular.module('beamng.apps')
.directive('raceTicker', ['bngApi', 'StreamsManager', function (bngApi, StreamsManager) {
  return {
    template:  
		'<div style="width:100%; height:100%;" layout="column" layout-align="top left" class="bngApp"><p id="leaderboard"></p>',
    replace: true,
    restrict: 'EA',
    
	link: function (scope, element, attrs) {      
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
						var scriptPercent = value.scriptTime / value.endScriptTime * 100
						
						//adds id and scriptTime to vehicles array
						if(vehicles.some(vehicle => vehicle.id === veh_id)){
							vehIndex = vehicles.findIndex((vehicle => vehicle.id === veh_id));
							vehicles[vehIndex].time = value.scriptTime;
						} else{
							//reading in the vehicles name from Beamng Engine Lua
							var veh_name = "test";
							bngApi.engineLua('scenetree.findObject(' + veh_id.toString() +'):getJBeamFilename()', function(name){
								veh_name = name;
								console.log(veh_name)
								let vehicle = {"id":veh_id,"time":value.scriptTime,"name":veh_name};
								vehicles.push(vehicle);
							})
						}
					}	
				})
		//formatting information for leaderboard
		let vehiclesSorted = vehicles.sort((a,b) => (a.time > b.time) ? -1 : ((b.time > a.time) ? 1 : 0));
		var i;
		if (vehicles.length > 0) {
			leaderboardFormatted= "";
		}
		for (i = 0; i < vehiclesSorted.length; i++) {
				leaderboardFormatted += (i+1) + "." + vehiclesSorted[i].name + "<br>";
		}
		document.getElementById("leaderboard").innerHTML = leaderboardFormatted;
		});
	}
	
  };
}])