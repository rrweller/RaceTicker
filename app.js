//config
//these remove the car from the leaderboard
var errorTolerance= 50; //how far a car can go off line before it gets yeeted after it crashes, if the value is too low cars that are still running the line will get removed.
var errorCounterSensitivity = 100; //how quickly a car gets yeeted when it goes off line, lower values = quicker
//these pause the position updating of the car
var timeoutAmount = 50; // how long a car stays timed out after going off line
var timeIncreaseThreshold = 1000; // how much a car needs to jump in scriptTime to be considered off line
//end config

var playerFocusID; //the ID of the car that the player looks at


var vehicles = [];
var tempVehicles = [];
var vehiclesSorted = [];
var leaderboardFormatted= "Start line to start leaderboard";

angular.module('beamng.apps')
.directive('raceTicker', ['bngApi', 'StreamsManager', function (bngApi, StreamsManager) {
  return {
    template:  
		'<div style="width:100%; height:100%;" layout="column" layout-align="top left" class="bngApp"><div id="leaderboard"></div>',
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
					setPlayingFalse();
					for (const [key, value] of Object.entries(data)) {
						let veh_id = key;
						var scriptPercent = value.scriptTime / value.endScriptTime * 100 ;
						var lineError = Math.abs(value.posError);
						var ScriptTimeIncrease= 0;
						//adds id and scriptTime to vehicles array
						if(vehicles.some(vehicle => vehicle.id === veh_id)){//if the vehicle already exists in the array 
							if (getVehicleByID(veh_id).averageLineError>errorTolerance) {
								getVehicleByID(veh_id).crashed = "true"; //if the vehicle crashed, log it
							} else {
								getVehicleByID(veh_id).crashed = "false";
							}
							getVehicleByID(veh_id).averageLineError = (errorCounterSensitivity*getVehicleByID(veh_id).averageLineError+lineError)/(errorCounterSensitivity+1);
							ScriptTimeIncrease = value.scriptTime-getVehicleByID(veh_id).lastScriptTime;
							getVehicleByID(veh_id).time = value.scriptTime;
							getVehicleByID(veh_id).playing = "true"; //if the vehicle is still playing on line .playing gets set to true
							getVehicleByID(veh_id).ScriptTimeIncrease = ScriptTimeIncrease;
							getVehicleByID(veh_id).lastScriptTime= value.scriptTime;
						}

						else {//if this vehicle is new
							var vehicle = {"id":veh_id,"time":value.scriptTime,"name":"unknown","playing":"true","ScriptTimeIncrease":0,"lastScriptTime":value.scriptTime,"storedScriptTime":0,"scriptTimePausedTimeout":0,"paused":"false","averageLineError":0,"crashed":"false"};
							vehicles.push(vehicle); //add the new vehicle to the array
							//reading in the vehicles name from Beamng Engine Lua
							bngApi.engineLua('scenetree.findObject(' + veh_id.toString() +'):getJBeamFilename()', function(name){
								getVehicleByID(veh_id).name = name;//add the name of the new vehicle
							});
						}
					}	
				});
				removeIdleVehicles();
				bngApi.engineLua('be:getPlayerVehicleID(0)',function(id){
					playerFocusID = id;
				});
				
				
				// manages vehicles maintaining their position for some time when going off-line
				tempVehicles=vehicles;
				var i;
				for (i = 0; i < tempVehicles.length; i++) {
					if (tempVehicles[i].ScriptTimeIncrease > timeIncreaseThreshold) {
						if (vehicles[i].scriptTimePausedTimeout == 0 & vehicles[i].paused == "false") {
							console.log("paused ScriptTime Increasing");
							vehicles[i].storedScriptTime = vehicles[i].lastScriptTime;
							vehicles[i].scriptTimePausedTimeout = timeoutAmount;
							vehicles[i].paused = "true";
						}
						if (vehicles[i].scriptTimePausedTimeout == 0 & vehicles[i].paused == "true") {
							vehicles[i].paused = "false";
						}
						if (vehicles[i].scriptTimePausedTimeout > 0 & vehicles[i].paused == "true") {
							tempVehicles[i].time = vehicles[i].storedScriptTime;
							vehicles[i].scriptTimePausedTimeout = vehicles[i].scriptTimePausedTimeout-1;
						}
					}
				}
				//formatting information for leaderboard
				vehiclesSorted = tempVehicles.sort((a,b) => (a.time > b.time) ? -1 : ((b.time > a.time) ? 1 : 0));
				if (vehicles.length > 0) {
					leaderboardFormatted= "";
				}
		
				var i;
				for (i = 0; i < vehiclesSorted.length; i++) {
					if (vehiclesSorted[i].crashed=="true"){
						leaderboardFormatted += '<p style="color:red; background-color:grey; border: 5px solid gray; margin: 1px 5px 1px 5px;">' + (i+1) + ". " + vehiclesSorted[i].name + "</p>";
					} else{
						leaderboardFormatted += '<p style="color:white; background-color:grey; border: 5px solid gray; margin: 1px 5px 1px 5px;">' + (i+1) + ". " + vehiclesSorted[i].name + "      +" + (Math.round((vehiclesSorted[0].time-vehiclesSorted[i].time)*100)/100) +  "s</p>";;
					}
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

//sets all .playing values to false
function setPlayingFalse(){
	var i;
	if (vehicles.length > 0) {
		for (i = 0; i < vehicles.length; i++) { //sets every .playing to false
			if (vehicles[i].playing == "true"){
				vehicles[i].playing = "false";
			}
		}
	}
}

//removes vehicles from array if they do not have .playing = true
function removeIdleVehicles() {
	var i;
	if (vehicles.length > 0){
	for (i = 0; i < vehicles.length; i++) {
		if (vehicles[i].playing == "false"){
				vehicles.splice(i,1);
				leaderboardFormatted= "Start line to start leaderboard";
			}
		}
	}
}