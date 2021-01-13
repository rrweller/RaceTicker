var vehicles = [];
var vehiclesSorted = [];
var leaderboardFormatted= "Start line to start leaderboard";


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
					var i;
					if (vehicles.length > 0) {
						for (i = 0; i < vehicles.length; i++) { //sets every .playing to false
							if (vehicles[i].playing == "true"){
								vehicles[i].playing = "false";
							}
						}
					}
					
					for (const [key, value] of Object.entries(data)) {
						let veh_id = key;
						var scriptPercent = value.scriptTime / value.endScriptTime * 100 ;
												
						//adds id and scriptTime to vehicles array
						if(vehicles.some(vehicle => vehicle.id === veh_id)){//if the vehicle already exists in the array 
							getVehicleByID(veh_id).time = value.scriptTime;
							getVehicleByID(veh_id).playing = "true"; //if the vehicle is still playing on line .playing gets set to true
						}

						else{//if this vehicle is new
							var vehicle = {"id":veh_id,"time":value.scriptTime,"name":"unknown","playing":"true"};
							vehicles.push(vehicle); //add the new vehicle to the array
							//reading in the vehicles name from Beamng Engine Lua
							bngApi.engineLua('scenetree.findObject(' + veh_id.toString() +'):getJBeamFilename()', function(name){
								getVehicleByID(veh_id).name = name;//add the name of the new vehicle
							});
						}
					}	
				});
				//removes vehicles from array if they do not have .playing = true
				var i;
				if (vehicles.length > 1){
					for (i = ´0; i < vehicles.length; i++) {
						if (vehicles[i].playing == "false"){
							delete vehicles[i];
						}
					}
				} else if (vehicles.length == 1) {
					if (vehicles[0].playing == "false"){
						vehicles=[];
						leaderboardFormatted= "Start line to start leaderboard";
					}	
				}
				//formatting information for leaderboard
				vehiclesSorted = vehicles.sort((a,b) => (a.time > b.time) ? -1 : ((b.time > a.time) ? 1 : 0));
				if (vehicles.length > 0) {
					leaderboardFormatted= "";
				}
		
				var i;
				for (i = 0; i < vehiclesSorted.length; i++) {
					leaderboardFormatted += (i+1) + "." + vehiclesSorted[i].name + "<br>";
				}
		
				document.getElementById("leaderboard").innerHTML = leaderboardFormatted;
		});
	}
	
  };
}])


//returns a vehicle with a given ID
 function getVehicleByID(id){
	let index = vehicles.findIndex((vehicle => vehicle.id === id));
	return vehicles[index]
}