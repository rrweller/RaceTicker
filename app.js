//config
//these remove the car from the leaderboard
var errorTolerance= 100; //how far a car can go off line before it gets yeeted after it crashes, if the value is too low cars that are still running the line will get removed.
var errorCounterSensitivity = 100; //how quickly a car gets yeeted when it goes off line, lower values = quicker
//these pause the position updating of the car
var timeoutAmount = 50; // how long a car stays timed out after going off line
var timeIncreaseThreshold = 5; // how much a car needs to jump in scriptTime to be considered off line
//end config

var playerFocusID; //the ID of the car that the player looks at
var todebug ="";

var vehicles = [];
var tempVehicles = [];
var vehiclesSorted = [];
var leaderboardFormatted= "Start line to start leaderboard";

var numberOfCars;
var prevVehLength;

angular.module('beamng.apps')
.directive('raceTicker', ['bngApi', 'StreamsManager', function (bngApi, StreamsManager) {
  return {
    template:  
		`<body><div style="width:100%; height:100%;" layout="column" layout-align="top left" class="bngApp">
		<div id="leaderboard"></div></body>
		<div id="cars"></div></body>
		<style> .jumperBTN {background-color:blue;color:white;border: 10px solid white;}</style>
		<style> .car {background-color:rgba(100,100,100,0.5);color:white;border: 1px solid white; ; width: 100%;text-align: left;}</style>
		<style> span {pointer-events: none;}</style>
		`,
    replace: true,
    restrict: 'EA',
    
	link: function (scope, element, attrs) {
		//Creates a Lua global table in GameEngine Lua
		bngApi.engineLua('script_state_table = {}');
		
		numberOfCars =0;

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
							var arrayID = vehicles.findIndex((vehicle => vehicle.id === veh_id));
							if (vehicles[arrayID].averageLineError>errorTolerance) {
								vehicles[arrayID].crashed = true; //if the vehicle crashed, log it
							} else {
								vehicles[arrayID].crashed = false;
							}
							vehicles[arrayID].averageLineError = (errorCounterSensitivity*vehicles[arrayID].averageLineError+lineError)/(errorCounterSensitivity+1);
							ScriptTimeIncrease = value.scriptTime-vehicles[arrayID].lastScriptTime;
							vehicles[arrayID].time = ((vehicles[arrayID].crashed)? vehicles[arrayID].lasterScriptTime:(value.scriptTime));//if the car isn't crashed, update its time
							vehicles[arrayID].playing = true; //if the vehicle is still playing on line .playing gets set to true
							vehicles[arrayID].ScriptTimeIncrease = ScriptTimeIncrease;
							vehicles[arrayID].lastScriptTime= value.scriptTime;
							vehicles[arrayID].lasterScriptTime= vehicles[arrayID].lastScriptTime;

							
						}

						else {//if this vehicle is new
							var vehicle = {"id":veh_id,"time":value.scriptTime,"name":"unknown","playing":true,"ScriptTimeIncrease":0,"lastScriptTime":value.scriptTime,"lasterScriptTime":value.scriptTime,"storedScriptTime":0,"scriptTimePausedTimeout":0,"paused":false,"averageLineError":0,"crashed":false};
							vehicles.push(vehicle); //add the new vehicle to the array
							//reading in the vehicles name from Beamng Engine Lua
							bngApi.engineLua('scenetree.findObject(' + veh_id.toString() +'):getJBeamFilename()', function(name){
								//simplify and add name
								var nameSpaces = name.replace(/_/g," ");
								var nameSplit = nameSpaces.split(" ");
								var simplifiedName= " ";
								var i;
								for(i = 0; i < nameSplit.length; i++){
									simplifiedName += ((nameSplit[i].charAt(0).toUpperCase()) + (nameSplit[i].slice(1))).toString() + " ";
								}
								getVehicleByID(veh_id).name = simplifiedName; 
							});
						}
					}	
				});
				removeIdleVehicles();
				bngApi.engineLua('be:getPlayerVehicleID(0)',function(id){
					playerFocusID = id;
				});
				
				if (todebug!=""){
					console.log(todebug);
					todebug ="";
					
				}
				
				// manages vehicles maintaining their position for some time when going off-line
				tempVehicles=vehicles;
				var i;
				for (i = 0; i < tempVehicles.length; i++) {
					if (tempVehicles[i].ScriptTimeIncrease > timeIncreaseThreshold) {
						console.log("paused ScriptTime Increasing");
						vehicles[i].storedScriptTime = vehicles[i].lasterScriptTime;
						vehicles[i].scriptTimePausedTimeout = timeoutAmount;
						vehicles[i].paused = true;
					} else if (vehicles[i].scriptTimePausedTimeout == 0 && vehicles[i].paused) {
						vehicles[i].paused = false;
					} else if (vehicles[i].scriptTimePausedTimeout > 0 && vehicles[i].paused) {
						tempVehicles[i].time = vehicles[i].storedScriptTime;
						vehicles[i].scriptTimePausedTimeout = vehicles[i].scriptTimePausedTimeout-1;
					}
				}
				//formatting information for leaderboard
				vehiclesSorted = tempVehicles.sort((a,b) => (a.time > b.time) ? -1 : ((b.time > a.time) ? 1 : 0));
				if (vehicles.length !== prevVehLength) {
					numberOfCars = 0;
					document.getElementById("cars").innerHTML= '';
				}
				
				//make a button for every car
				for (;numberOfCars<vehiclesSorted.length;numberOfCars++){
						
					var button = document.createElement("button");
					button.innerHTML = "If you see this, it means that Oren did something wrong in the code of the clickable cars";
					var leaderboard = document.getElementById("cars");
					leaderboard.appendChild(button);
					button.className  = "car";
					button.id = numberOfCars
					button.value = (numberOfCars+1);//the value represents the position that the button represents, numberOfCars starting from 0, positions from 1
					button.addEventListener("click",function(){ //on click, jump to the car that that is in the position that is the value of the button
							scope.jumpToCarPos(parseInt((this.value)));
					});
						
				}

				
				prevVehLength= vehicles.length;
				var i;
				for (i = 0; i < vehiclesSorted.length; i++) {
					let carText ="";
					let isBold = false;
					
					if (playerFocusID == vehiclesSorted[i].id ){
						carText+="<b>";
						isBold = true;
					}
					if (vehiclesSorted[i].crashed){
						carText += '<span style="color:red; margin: 1px 5px 1px 5px;">' + (i+1) + ". " + vehiclesSorted[i].name + "</span>";
					} else if (vehiclesSorted[i].paused){
						carText += '<span style="color:orange; margin: 1px 5px 1px 5px;">' + (i+1) + ". " + vehiclesSorted[i].name + "</span>";
					} else{
						carText += '<span style="color:white; margin: 1px 5px 1px 5px;">' + (i+1) + ". " + vehiclesSorted[i].name + "      " + (i==0?" <span style=\"color: #3FB0FF\">+0s</span> ": "<span style=\"color: red\">+" + (Math.round((vehiclesSorted[0].time-vehiclesSorted[i].time)*100)/100)+"s") +  "</span>";

					}
					if (isBold){
						carText += "</b>";
					}
					
					document.getElementById(i).innerHTML = carText;

				}
				
		});
		
		scope.jumpToCarPos = function(pos){
			debug("player wants to jump to car at pos "+pos)
			bngApi.engineLua('be:enterVehicle("0",scenetree.findObject('+vehiclesSorted[pos-1].id+'))');
		}
	
	}
  };
}])

function debug(str){
	todebug = ""+str;
	
}

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
			if (vehicles[i].playing){
				vehicles[i].playing = false;
			}
		}
	}
}

//removes vehicles from array if they do not have .playing = true
function removeIdleVehicles() {
	var i;
	if (vehicles.length > 0){
	for (i = 0; i < vehicles.length; i++) {
		if (!vehicles[i].playing){
				vehicles.splice(i,1);
				leaderboardFormatted= "Start line to start leaderboard";
			}
		}
	}
}