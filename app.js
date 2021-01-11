angular.module('beamng.apps')
.directive('myApp', ['StreamsManager', function (StreamsManager) {
  return {
    template:  '[Some HTML Content]',
    replace: true,
    restrict: 'EA',
    link: function (scope, element, attrs) {      
      // An optional list of streams that will be used in the app
      var streamsList = [/* streams here */];
 
      // Make the needed streams available.
      StreamsManager.add(streamsList);
 
      // Make sure we clean up after closing the app.
      scope.$on('$destroy', function () {
        StreamsManager.remove(streamsList);
      });
 
      scope.$on('streamsUpdate', function (event, streams) {
        /* Some code that uses the streams' values */
      });
    }
  };
}])