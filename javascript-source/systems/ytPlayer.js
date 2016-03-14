/**
 * ytPlayer.js
 *
 * This is version 2 of the youtube player.
 *
 */
(function() {
    var playlistDbPrefix = 'ytPlaylist_',
        randomizePlaylist = ($.inidb.exists('ytSettings', 'randomizePlaylist') ? $.getIniDbBoolean('ytSettings', 'randomizePlaylist') : false),
        announceInChat = ($.inidb.exists('ytSettings', 'announceInChat') ? $.getIniDbBoolean('ytSettings', 'announceInChat') : false),
        activePlaylistname = ($.inidb.exists('ytSettings', 'activePlaylistname') ? $.inidb.get('ytSettings', 'activePlaylistname') : 'default'),
        baseFileOutputPath = ($.inidb.exists('ytSettings', 'baseFileOutputPath') ? $.inidb.get('ytSettings', 'baseFileOutputPath') : './addons/youtubePlayer/'),
        songRequestsEnabled = ($.inidb.exists('ytSettings', 'songRequestsEnabled') ? $.getIniDbBoolean('ytSettings', 'songRequestsEnabled') : true),
        songRequestsMaxParallel = ($.inidb.exists('ytSettings', 'songRequestsMaxParallel') ? parseInt($.inidb.get('ytSettings', 'songRequestsMaxParallel')) : 1),
        songRequestsMaxSecondsforVideo = ($.inidb.exists('ytSettings', 'songRequestsMaxSecondsforVideo') ? parseInt($.inidb.get('ytSettings', 'songRequestsMaxSecondsforVideo')) : (8 * 60));
        playlistDJname = ($.inidb.exists('ytSettings', 'playlistDJname') ? $.inidb.get('ytSettings', 'playlistDJname') : $.botName);

        /* enum for player status */
        playerStateEnum = {
            NEW: -2,
            UNSTARTED: -1,
            ENDED: 0,
            PLAYING: 1,
            PAUSED: 2,
            BUFFERING: 3,
            CUED: 5,
            KEEPALIVE: 200
        },
        /* @type {PlayerClientInterface} */
        connectedPlayerClient = null,
        /* @type {BotPlayList} */
        currentPlaylist = null;

    /**
     * @class
     * @description This class holds information about a youtube video.
     * @param {string} searchQuery
     * @param {string} owner
     * @throws {Exception}
     * @requires PlayerClientInterface
     */
    function YoutubeVideo(searchQuery, owner) {
        var videoId = '',
            videoTitle = '',
            videoLength = -1;

        this.found = false;

        /**
         * @function getVideoId
         * @returns {string}
         */
        this.getVideoId = function() {
            return videoId;
        };

        /**
         * @function getOwner
         * @returns {string}
         */
        this.getOwner = function() {
            return owner;
        };

        /**
         * @function getVideoLength
         * @returns {number}
         */
        this.getVideoLength = function() {
            if (videoLength != -1) {
                return videoLength;
            }

            var lengthData = $.youtube.GetVideoLength(videoId);
            while (lengthData[0] == 0 && lengthData[1] == 0 && lengthData[2] == 0) {
                lengthData = $.youtube.GetVideoLength(videoId);
            }
            if (lengthData[0] == 0 && lengthData[1] == 0 && lengthData[2] == 0) {
                return 0;
            }
            videoLength = lengthData[2];
            return lengthData[2];
        };

        /**
         * @function getVideoLengthMMSS
         * @returns {String}
         */
        this.getVideoLengthMMSS = function() {
            var min,
                sec;

            if (videoLength == -1) {
                videoLength = this.getVideoLength();
            }

            min = (videoLength / 60 < 10 ? "0" : "") + Math.floor(videoLength / 60);
            sec = (videoLength % 60 < 10 ? "0" : "") + Math.floor(videoLength % 60);

            return min + ":" + sec;
        };

        /**
         * @function getVideoLink
         * @returns {string}
         */
        this.getVideoLink = function() {
            return 'https://youtu.be/' + videoId;
        };

        /**
         * @function getVideoTitle
         * @returns {string}
         */
        this.getVideoTitle = function() {
            return videoTitle;
        };

        /** START CONTRUCTOR YoutubeVideo() */

        if (!searchQuery) {
            throw "No Search Query Given";
        }

        if (!owner.equals(playlistDJname)) {
            owner = owner.toLowerCase();
        }

        var data = null;
        do {
            data = $.youtube.SearchForVideo(searchQuery);
        } while (data[0].length() < 11 && data[1] != "No Search Results Found");

        videoId = data[0];
        videoTitle = data[1];

        if (videoTitle.equalsIgnoreCase('video marked private') || videoTitle.equalsIgnoreCase('no search results found')) {
            throw videoTitle;
        }

        /** END CONTRUCTOR YoutubeVideo() */
    }

    /**
     * @class
     * @description This class loads a playlist and takes care of managing currently playing songs and songrequest.
     * @param {string} playlistName
     * @param {boolean} loadDefaultPlaylist
     * @return {boolean}
     * @requires YoutubeVideo
     */
    function BotPlayList(playlistName, loadDefault) {
        var previousVideo = null,
            currentVideo = null,
            playListDbId = playlistDbPrefix + playlistName,
            defaultPlaylist = [],          // @type { Integer[] }
            defaultPlaylistReadOnly = [],  // @type { Integer[] }
            requests = [],                 // @type { YoutubeVideo[] }
            requestFailReason = '';

        this.playlistName = playlistName;
        this.loaded = false;

        /** 
         * @function importPlaylistFile
         * @param {String}
         * @param {String}
         * @return {String}
         */
        this.importPlaylistFile = function(listName, fileName) {
            var importedList = [],
                importCount = 0;

            if ($.inidb.exists('yt_playlists_registry', 'ytPlaylist_' + listName)) {
                if ($.fileExists("./addons/youtubePlayer/" + fileName)) {
                    importedList = readFile("./addons/youtubePlayer/" + fileName);
                    for (var i = 0; i < importedList.length; i++) {
                        try {
                            var youtubeVideo = new YoutubeVideo(importedList[i], 'importPlaylistFile');
                            importCount++;
                            $.inidb.set(playlistDbPrefix + listName, importCount, youtubeVideo.getVideoId());
                        } catch (ex) {
                            $.logError("ytPlayer.js", 182, "importPlaylistFile::skipped [" + importedList[i] + "]: " + ex);
                        }
                    }
                    $.inidb.set(playlistDbPrefix + listName, 'lastkey', importCount);

                    return $.lang.get('ytplayer.command.importpl.file.success', importCount, fileName, listName);
                } else {
                    return $.lang.get('ytplayer.command.importpl.file.404', fileName);
                    $.say("File does not exist: " + fileName);
                    return false;
                }
            } 
            return $.lang.get('ytplayer.command.importpl.file.registry404', listName);
        };

        /** 
         * @function loadNewPlaylist
         * @return {Boolean}
         */
        this.loadNewPlaylist = function(listName) {
           if ($.inidb.exists('yt_playlists_registry', 'ytPlaylist_' + listName)) {
               this.playlistName = listName;
               playListDbId = playlistDbPrefix + listName;
               this.loadPlaylistKeys();
               connectedPlayerClient.pushPlayList();
            }
        };

        /**
         * @function getplayListDbId
         * @return {String}
         */
        this.getplayListDbId = function() {
            return playListDbId;
        };

        /**
         * @function getRequestFailReason
         * @return {String}
         */
        this.getRequestFailReason = function() {
            return requestFailReason;
        };

        /**
         * @function addToPlaylist
         * @param {YoutubeVideo} youtubeVideo
         * @param {string} [targetPlaylistName]
         * @return {number}
         */
        this.addToPlaylist = function(youtubeVideo, targetPlaylistName) {
            if (!youtubeVideo) {
                return -1;
            }
            var newKey;
            targetPlaylistName = (targetPlaylistName ? targetPlaylistName : this.playlistName);
            if (this.videoExistsInPlaylist(youtubeVideo, targetPlaylistName)) {
                return -1;
            }
            if (targetPlaylistName) {
                newKey = (!$.inidb.exists(playlistDbPrefix + targetPlaylistName, 'lastkey') ? 0 : parseInt($.inidb.get(playlistDbPrefix + targetPlaylistName, 'lastkey')) + 1);
                $.inidb.set(playlistDbPrefix + targetPlaylistName, newKey, youtubeVideo.getVideoId());
                $.inidb.set(playlistDbPrefix + targetPlaylistName, 'lastkey', newKey);
            }
            if (targetPlaylistName.equals(this.playlistName)) {
                this.loadPlaylistKeys();
                connectedPlayerClient.pushPlayList();
            } 
            return newKey;
        };

        /**
         * @function deleteCurrentVideo
         * @returns {Number}
         */
        this.deleteCurrentVideo = function() {
            var keyList = $.inidb.GetKeyList(playListDbId, ''),
                i;

            for (i = 0; i < keyList.length; i++) {
                if (!keyList[i].equals("lastkey")) {
                    if ($.inidb.get(playListDbId, keyList[i]) == currentVideo.getVideoId()) {
                        $.inidb.del(playListDbId, keyList[i]);
                        break;
                    }
                }
            }

            if (this.loadPlaylistKeys() > 0) {
                connectedPlayerClient.pushPlayList();
                this.nextVideo();
            } else {
                connectedPlayerClient.pushPlayList();
            }

            return this.getplaylistLength();
        };

        /**
         * @function deletePlaylist
         * @returns {boolean}
         */
        this.deletePlaylist = function(listName) {
            if ($.inidb.exists('yt_playlists_registry', 'ytPlaylist_' + listName)) {
                $.inidb.del('yt_playlists_registry', 'ytPlaylist_' + listName);
                $.inidb.RemoveFile('ytPlaylist_' + listName);
                return true;
            }
            return false;
        };

        /**
         * @function getCurrentVideo
         * @returns {YoutubeVideo}
         */
        this.getCurrentVideo = function() {
            return currentVideo;
        };

        /**
         * @function getPlaylistname
         * @returns {string}
         */
        this.getPlaylistname = function() {
            return this.playlistName;
        };

        /**
         * @function getplaylistLength
         * @returns {Number}
         */
        this.getplaylistLength = function() {
            return defaultPlaylist.length;
        };

        /**
         * @function getReadOnlyPlaylistData
         * @returns {String}[]
         */
        this.getReadOnlyPlaylistData = function() {
            return defaultPlaylistReadOnly;
        }

        /**
         * @function getPreviousVideo
         * @returns {YoutubeVideo}
         */
        this.getPreviousVideo = function() {
            return previousVideo;
        };

        /**
         * @function getRequestList
         * @returns {List}{YoutubeVideo}
         */
        this.getRequestList = function() {
            return requests;
        }

        /**
         * @function getRequestAtIndex
         * @returns {YoutubeVideo}
         */
        this.getRequestAtIndex = function(index) {
            if (index > requests.length) {
                return null;
            }
            return requests[index];
        }

        /**
         * @function getRequestsCount
         * @returns {Number}
         */
        this.getRequestsCount = function() {
            return requests.length;
        };

        /**
         * @function jumpToSong
         * @param playlistPosition
         * @return {boolean}
         */
        this.jumpToSong = function(playlistPosition) {
            if ($.inidb.exists(playListDbId, playlistPosition)) {
                previousVideo = currentVideo;
                try {
                    currentVideo = new YoutubeVideo($.inidb.get(playListDbId, playlistPosition), $.ownerName);
                } catch (ex) {
                    $.logError("ytPlayer.js", 233, "YoutubeVideo::exception: " + ex);
                    return false;
                }
                connectedPlayerClient.play(currentVideo);
                return true;
            } else {
                return false;
            }
        };

        /**
         * @function loadPlaylistKeys
         * @returns {number}
         */
        this.loadPlaylistKeys = function() {
            var keyList = $.inidb.GetKeyList(playListDbId, '');

            defaultPlaylist = [];
            defaultPlaylistReadOnly = [];

            for (var i = 0; i < keyList.length; i++) {
                if (!keyList[i].equals("lastkey")) {
                  defaultPlaylist.push(keyList[i]);
                }
            }
            defaultPlaylist = (randomizePlaylist ? $.arrayShuffle(defaultPlaylist) : defaultPlaylist);
            for (var i = 0; i < defaultPlaylist.length; i++) {
                defaultPlaylistReadOnly.push(defaultPlaylist[i]);
            } 
            this.loaded = true;
            return keyList.length;
        };

        /**
         * @function nextVideo
         * @return {YoutubeVideo}
         */
        this.nextVideo = function() {
            if (!connectedPlayerClient) {
                return null;
            }

            previousVideo = currentVideo;

            if (requests.length > 0) {
                currentVideo = requests.shift();
            } else {
                if (defaultPlaylist.length == 0) {
                    if (this.loadPlaylistKeys() == 0) {
                        return null;
                    }
                }

                try {
                    var playListIndex = defaultPlaylist.shift();                    
                    currentVideo = new YoutubeVideo($.inidb.get(playListDbId, playListIndex), playlistDJname);
                } catch (ex) {
                    $.logError("ytPlayer.js", 277, "YoutubeVideo::exception: " + ex);
                    this.nextVideo();
                }

            }

            connectedPlayerClient.play(currentVideo);
            this.updateCurrentSongFile(currentVideo);

            if (announceInChat) {
                $.say($.lang.get('ytplayer.announce.nextsong', currentVideo.getVideoTitle(), currentVideo.getOwner()));
            }
            return currentVideo;
        };

        /**
         * @function preparePlaylist
         * @return {boolean}
         */
        this.preparePlaylist = function() {
            $.inidb.set('ytSettings', 'activePlaylistname', 'default');
            if (!$.inidb.exists('yt_playlists_registry', playListDbId) || !$.inidb.FileExists(playListDbId)) {
                $.setIniDbBoolean('yt_playlists_registry', playListDbId, true);
                $.inidb.AddFile(playListDbId);
            }
            return true;
        };

        /**
         * @function removeSong
         * @param {String} YouTube ID
         * @return {String} 
         */
        this.removeSong = function(youTubeID) {
            var songTitle = null,
                newRequests = [],
                youTubeObject,
                i;

            for (i in requests) {
                if (requests[i].getVideoId().equals(youTubeID)) {
                    songTitle = requests[i].getVideoTitle();
                } else {
                    newRequests.push(requests[i]);
                }
            }
            requests = newRequests;
            return songTitle;
        };

        /**
         * @function removeUserSong
         * @param {String} 
         * @return {String}
         */
        this.removeUserSong = function(username) {
            var songTitle = null,
                newRequests = [],
                youTubeObject,
                i;

            for (i = requests.length - 1; i >= 0; i--) {
                if (requests[i].getOwner().equals(username) && songTitle == null) {
                    songTitle = requests[i].getVideoTitle();
                } else {
                    newRequests.push(requests[i]);
                }
            }
            requests = newRequests;
            return songTitle;
        };

        /**
         * @function requestSong
         * @param {string} searchQuery
         * @param {string} requestOwner
         * @return {YoutubeVideo}
         */
        this.requestSong = function(searchQuery, requestOwner) {
            if (!$.isAdmin(requestOwner) && (!songRequestsEnabled || this.senderReachedRequestMax(requestOwner))) {
                if (this.senderReachedRequestMax(requestOwner)) {
                    requestFailReason = $.lang.get('ytplayer.requestsong.error.maxrequests');
                } else {
                    requestFailReason = $.lang.get('ytplayer.requestsong.error.disabled');
                }
                return null;
            }

            try {
                var youtubeVideo = new YoutubeVideo(searchQuery, requestOwner);
            } catch (ex) {
                requestFailReason = $.lang.get('ytplayer.requestsong.error.yterror', ex);
                $.logError("ytPlayer.js", 315, "YoutubeVideo::exception: " + ex);
                return null;
            }

            if (this.videoExistsInRequests(youtubeVideo)) {
                requestFailReason = $.lang.get('ytplayer.requestsong.error.exists');
                return null;
            }

            if (this.videoLengthExceedsMax(youtubeVideo) && !$.isAdmin(requestOwner)) {
                requestFailReason = $.lang.get('ytplayer.requestsong.error.maxlength', youtubeVideo.getVideoLengthMMSS());
                return null;
            }

            requests.push(youtubeVideo);
            var playerState = connectedPlayerClient.checkState();
            if (playerState == playerStateEnum.UNSTARTED || playerState == playerStateEnum.ENDED) {
                this.nextVideo();
            }
            return youtubeVideo;
        };

        /**
         * @function senderReachedRequestMax
         * @param {string} sender
         * @returns {boolean}
         */
        this.senderReachedRequestMax = function(sender) {
            var currentRequestCount = 0,
                i;

            sender = sender.toLowerCase();

            for (i in requests) {
                if (requests[i].getOwner() == sender) {
                    ++currentRequestCount;
                }
            }

            return (currentRequestCount >= songRequestsMaxParallel);
        };

        /**
         * @function updateCurrentSongFile
         * @param {YoutubeVideo} youtubeVideo
         */
        this.updateCurrentSongFile = function(youtubeVideo) {
            $.writeToFile(
                youtubeVideo.getVideoTitle(),
                baseFileOutputPath + 'currentSong.txt',
                false
            );
        };

        /**
         * @function videoExistsInPlaylist
         * @param {YoutubeVideo} youtubeVideo
         * @param {string} targetPlaylistName
         * @returns {boolean}
         */
        this.videoExistsInPlaylist = function(youtubeVideo, targetPlaylistName) {
            var keyList = $.inidb.GetKeyList(playlistDbPrefix + targetPlaylistName, ''),
                i;

            for (i in keyList) {
                if (!keyList[i].equals("lastkey")) {
                    if ($.inidb.get(playlistDbPrefix + targetPlaylistName, keyList[i]) == youtubeVideo.getVideoId()) {
                        return true;
                    }
                }
            }
            return false;
        };

        /**
         * @function videoExistsInRequests
         * @param {YoutubeVideo} youtubeVideo
         * @returns {boolean}
         */
        this.videoExistsInRequests = function(youtubeVideo) {
            var i;

            for (i in requests) {
                if (requests[i].getVideoId() == youtubeVideo.getVideoId()) {
                    return true;
                }
            }

            return false;
        };

        /**
         * @function videoLengthExceedsMax
         * @param {YoutubeVideo} youtubeVideo
         * @returns {boolean}
         */
        this.videoLengthExceedsMax = function(youtubeVideo) {
            return (youtubeVideo.getVideoLength() > songRequestsMaxSecondsforVideo);
        };

        /** START CONTRUCTOR PlayList() */

        if (!this.playlistName) {
            return this.loaded;
        }

        this.preparePlaylist();
        if (loadDefault) {
            this.loadPlaylistKeys();
        }

        /** END CONTRUCTOR PlayList() */
    }

    /**
     * @class
     * @description This class acts as interface between the javascript and any connected player clients
     */
    function PlayerClientInterface() {
        var client = $.ytplayer,
            playerPaused = false;

        /**
         * @function pushPlayList
         */
        this.pushPlayList = function() {
            var jsonList = {},
                playList = [],
                youtubeObject,
                i;

            if (currentPlaylist) {

                jsonList['playlistname'] = currentPlaylist.getPlaylistname()+'';
                jsonList['playlist'] = [];
                playList = currentPlaylist.getReadOnlyPlaylistData();

                for (i = 0; i < playList.length; i++) {
                    youtubeObject = new YoutubeVideo($.inidb.get(currentPlaylist.getplayListDbId(), playList[i]), $.botName);
                    jsonList['playlist'].push({
                        "song": youtubeObject.getVideoId() + '',
                        "title": youtubeObject.getVideoTitle() + '',
                        "duration": youtubeObject.getVideoLengthMMSS() + ''
                    });
                }
                client.playList(JSON.stringify(jsonList));
            }
        };

        /**
         * @function pushSongList
         */
        this.pushSongList = function() {
            var jsonList = {},
                requestList = [],
                youtubeObject,
                i;

            if (currentPlaylist) {
                jsonList['songlist'] = [];
                requestList = currentPlaylist.getRequestList();
                for (i in requestList) {
                    youtubeObject = requestList[i];
                    jsonList['songlist'].push({
                        "song": youtubeObject.getVideoId() + '',
                        "title": youtubeObject.getVideoTitle() + '',
                        "duration": youtubeObject.getVideoLengthMMSS() + '',
                        "requester": youtubeObject.getOwner() + ''
                    });
                }
                client.songList(JSON.stringify(jsonList));
            }
        };


        /**
         * @function play
         * @param {YoutubeVideo} youtubeVideo
         */
        this.play = function(youtubeVideo) {
            client.play(youtubeVideo.getVideoId(), youtubeVideo.getVideoTitle(), youtubeVideo.getVideoLengthMMSS(), youtubeVideo.getOwner());
        };

        /**
         * @function getVolume
         * @returns {number}
         */
        this.getVolume = function() {
            return client.getVolume();
        };

        /**
         * @function setVolume
         * @param {number} volume
         */
        this.setVolume = function(volume) {
            volume = parseInt(volume);
            if (!isNaN(volume)) {
                client.setVolume(volume);
                $.inidb.set('ytSettings', 'volume', volume);
            }
        };

        /**
         * @function togglePause
         * @returns {boolean}
         */
        this.togglePause = function() {
            client.pause();
            playerPaused = !playerPaused;
            return playerPaused;
        };

        /**
         * @function checkState
         * @returns {Int}
         */
        this.checkState = function() {
            return parseInt(client.getPlayerState());
        }
    }

    /**
     * @event yTPlayerSongRequest
     */
    $.bind('yTPlayerSongRequest', function(event) {
        var request = currentPlaylist.requestSong(event.getSearch(), $.ownerName);
        if (request != null) {
            connectedPlayerClient.pushSongList();
        }
    });

    /**
     * @event ytPlayerStealSong
     */
    $.bind('yTPlayerStealSong', function(event) {
        currentPlaylist.addToPlaylist(currentPlaylist.getCurrentVideo());
    });

    /**
     * @event ytPlayerSkipSong
     */
    $.bind('yTPlayerSkipSong', function(event) {
        currentPlaylist.nextVideo();
        connectedPlayerClient.pushSongList();
    });

    /**
     * @event yTPlayerDeleteSR
     */
    $.bind('yTPlayerDeleteSR', function(event) {
        currentPlaylist.removeSong(event.getId());
        connectedPlayerClient.pushSongList();
    });

    /**
     * @event yTPlayerVolume
     */
    $.bind('yTPlayerVolume', function(event) {
        $.inidb.set('ytSettings', 'volume', event.getVolume());
    });

    /**
     * @event yTPlayerRequestSonglist
     */
    $.bind('yTPlayerRequestSonglist', function(event) {
        connectedPlayerClient.pushSongList();
    });

    /**
     * @event yTPlayerRequestPlaylist
     */
    $.bind('yTPlayerRequestPlaylist', function(event) {
        connectedPlayerClient.pushPlayList();
    });


    /**
     * @event yTPlayerState
     */
    $.bind('yTPlayerState', function(event) {
        var state = event.getStateId(),
            volume;

        if (state == playerStateEnum.NEW) {
            volume = $.inidb.exists('ytSettings', 'volume') ? parseInt($.inidb.get('ytSettings', 'volume')) : 5;
            connectedPlayerClient.setVolume(volume);
            if (currentPlaylist) {
                currentPlaylist.nextVideo();
            }
        }

        if (state == playerStateEnum.ENDED) {
            if (currentPlaylist) {
                currentPlaylist.nextVideo();
            }
        }
    });

    /**
     * @event yTPlayerConnect
     */
    $.bind('yTPlayerConnect', function(event) {
        connectedPlayerClient = new PlayerClientInterface();

        $.consoleLn($.lang.get('ytplayer.console.client.connected'));
        if (songRequestsEnabled) {
            $.say($.lang.get('ytplayer.songrequests.enabled'));
        }
        connectedPlayerClient.pushPlayList();
    });

    /**
     * @event yTPlayerDisconnect
     */
    $.bind('yTPlayerDisconnect', function(event) {
        connectedPlayerClient = null;

        $.consoleLn($.lang.get('ytplayer.console.client.disconnected'));
        if (!songRequestsEnabled) {
            $.say($.lang.get('ytplayer.songrequests.disabled'));
        }
    });

    /**
     * @event command
     */
    $.bind('command', function(event) {
        var command = event.getCommand(),
            sender = event.getSender().toLowerCase(),
            args = event.getArgs(),
            pActions,
            action,
            actionArgs;

        /**
         * @commandpath ytp - Base command to manage YouTube player settings
         */
        if (command.equalsIgnoreCase('ytp')) {
            pActions = ['volume', 'pause'].join(', ');
            action = args[0];
            actionArgs = args.splice(1);

            if (!action) {
                $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.ytp.usage'));
                return;
            }

            /**
             * @commandpath ytp djname [DJ Name] - Name the DJ for playlists
             */
           if (action.equalsIgnoreCase('djname')) {
               if (actionArgs[0]) {
                  playlistDJname = actionArgs.join(' ');
                  $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.ytp.setdjname.success', playlistDJname));
                  $.inidb.set('ytSettings', 'playlistDJname', playlistDJname);
               } else {
                  $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.ytp.setdjname.usage'));
               }
           }
         
            /**
             * @commandpath ytp delrequest [YouTube ID] - Delete a song that has been requested
             */
            if (action.equalsIgnoreCase('delrequest')) {
                if (actionArgs[0]) {
                    var removedSongTitle = currentPlaylist.removeSong(actionArgs[0]);
                    if (removedSongTitle) {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.delrequest.success', actionArgs[0], removedSongTitle));
                        connectedPlayerClient.pushSongList();
                    } else {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.delrequest.404', actionArgs[0]));
                    }
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.delrequest.usage'));
                }
                return;
            }

            /**
             * @commandpath ytp volume [0-100] - Set the player client's volume, omit the parameter to have the current volume announced
             */
            if (action.equalsIgnoreCase('volume')) {
                if (!connectedPlayerClient) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.client.404'));
                    return;
                } 
                if (actionArgs[0] && !isNaN(parseInt(actionArgs[0]))) {
                    connectedPlayerClient.setVolume(actionArgs[0]);
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.volume.set', actionArgs[0]));
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.volume.get', connectedPlayerClient.getVolume()));
                }
                return;
            }

            /**
             * @commandpath ytp pause - Toggle the player client's play/pause state
             */
            if (action.equalsIgnoreCase('pause')) {
                if (!connectedPlayerClient) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.client.404'));
                    return;
                } 
                connectedPlayerClient.togglePause();
                return;
            }

            /**
             * @commandpath ytp togglerandom - Toggle randomizing playlists
             */
            if (action.equalsIgnoreCase('togglerandom')) {
                randomizePlaylist = !randomizePlaylist;

                $.setIniDbBoolean('ytSettings', 'randomizePlaylist', randomizePlaylist);
                if (currentPlaylist) {
                    currentPlaylist.loadPlaylistKeys();
                }
                if (connectedPlayerClient) {
                    connectedPlayerClient.pushPlayList();
                }

                $.say($.whisperPrefix(sender) + $.lang.get(
                    'ytplayer.command.ytp.togglerandom.toggled', (randomizePlaylist ? $.lang.get('common.enabled') : $.lang.get('common.disabled'))
                ));
                return;
            }

            /**
             * @commandpath ytp toggleannounce - Toggle announcing now playing in the chat
             */
            if (action.equalsIgnoreCase('toggleannounce')) {
                announceInChat = !announceInChat;

                $.setIniDbBoolean('ytSettings', 'announceInChat', announceInChat);

                $.say($.whisperPrefix(sender) + $.lang.get(
                    'ytplayer.command.ytp.toggleannounce.toggled', (announceInChat ? $.lang.get('common.enabled') : $.lang.get('common.disabled'))
                ));
                return;
            }

            /**
             * @commandpath ytp togglesongrequests - Toggle announcing now playing in the chat
             */
            if (action.equalsIgnoreCase('togglesongrequests')) {
                songRequestsEnabled = !songRequestsEnabled;

                $.setIniDbBoolean('ytSettings', 'songRequestsEnabled', songRequestsEnabled);

                if (songRequestsEnabled) {
                    $.say($.lang.get('ytplayer.songrequests.enabled'));
                } else {
                    $.say($.lang.get('ytplayer.songrequests.disabled'));
                }
                return;
            }

            /**
             * @commandpath ytp setrequestmax [number of max parallel requests] - Set the maximum of parallel songrequests a user can make
             */
            if (action.equalsIgnoreCase('setrequestmax')) {
                if (!actionArgs[0] || isNaN(parseInt(actionArgs[0]))) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.ytp.setrequestmax.usage'));
                    return;
                }

                songRequestsMaxParallel = parseInt(actionArgs[0]);
                $.inidb.set('ytSettings', 'songRequestsMaxParallel', songRequestsMaxParallel);
                $.say($.lang.get('ytplayer.command.ytp.setrequestmax.success', songRequestsMaxParallel));
                return;
            }

            /**
             * @commandpath ytp setmaxvidlength [max video length in seconds] - Set the maximum length of a song that may be requested
             */
            if (action.equalsIgnoreCase('setmaxvidlength')) {
                if (!actionArgs[0] || isNaN(parseInt(actionArgs[0]))) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.ytp.setmaxvidlength.usage'));
                    return;
                }

                songRequestsMaxSecondsforVideo = parseInt(actionArgs[0]);
                $.inidb.set('ytSettings', 'songRequestsMaxParallel', songRequestsMaxSecondsforVideo);
                $.say($.lang.get('ytplayer.command.ytp.setmaxvidlength.success', songRequestsMaxSecondsforVideo));
                return;
            }
        }

        /**
         * @commandpath playlist - Base command: Manage playlists
         */
        if (command.equalsIgnoreCase('playlist')) {
            pActions = ['add', 'delete', 'loadpl', 'deletepl', 'importpl'].join(', ');
            action = args[0];
            actionArgs = args.splice(1);

            if (!action) {
                $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.usage', pActions));
                return;
            }

            /**
             * @commandpath playlist add [youtube link] - Add a song to the current playlist
             */
            if (action.equalsIgnoreCase('add')) {
                if (!connectedPlayerClient) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.client.404'));
                    return;
                } 
                if (actionArgs.length > 0) {
                    try {
                        var youtubeVideo = new YoutubeVideo(actionArgs.join(' '), sender);
                    } catch (ex) {
                        $.logError("ytPlayer.js", 641, "YoutubeVideo::exception: " + ex);
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.add.failed', ex));
                        return;
                    }

                    if (currentPlaylist.addToPlaylist(youtubeVideo)) {
                        $.say($.whisperPrefix(sender) + $.lang.get(
                            'ytplayer.command.playlist.add.success',
                            youtubeVideo.getVideoTitle(),
                            currentPlaylist.getPlaylistname()
                        ));
                    } else {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.add.failed', currentPlaylist.getRequestFailReason()));
                    }
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.add.usage'));
                }
                return;
            }

            /**
             * @commandpath playlist delete - Delete the current song from the current playlist
             */
            if (action.equalsIgnoreCase('delete')) {
                if (!connectedPlayerClient) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.client.404'));
                    return;
                } 
                currentPlaylist.deleteCurrentVideo();
                return;
            }

            /**
             * @commandpath playlist loadpl [playlist name] - Load playlist by name, calling this command with an unknown playlist will create it for you.
             */
            if (action.equalsIgnoreCase('loadpl')) {
                if (!connectedPlayerClient) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.client.404'));
                    return;
                } 
                if (actionArgs.length > 0) {
                    var requestedPlaylist = new BotPlayList(actionArgs[0], true);
                    if (requestedPlaylist.getplaylistLength() == 0) {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.load.success.new', requestedPlaylist.getPlaylistname()));
                    } else {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.load.success', requestedPlaylist.getPlaylistname()));
                    }
                    currentPlaylist.loadNewPlaylist(actionArgs[0]);
                    connectedPlayerClient.pushPlayList();
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.load.usage'));
                }
                return;
            }

            /**
             * @commandpath playlist listpl - List the playlists
             */
            if (action.equalsIgnoreCase('listpl')) {
                var playlistsList = $.inidb.GetKeyList('yt_playlists_registry', '');

                if (playlistsList) { 
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.listpl', playlistsList.join(', ').replace(/ytPlaylist_/g, '')));
                }
            }

            /**
             * @commandpath playlist deletepl [playlist name] - Delete a playlist by name
             */
            if (action.equalsIgnoreCase('deletepl')) {
                if (!currentPlaylist) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.client.404'));
                    return;
                } 
                if (actionArgs.length > 0) {
                    if (actionArgs[0].equalsIgnoreCase('default')) {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.delete.isdefault'));
                        return;
                    }
                    if (currentPlaylist.deletePlaylist(actionArgs[0])) {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.delete.success', actionArgs[0]));
                    } else {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.delete.404', actionArgs[0]));
                    }
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.playlist.delete.usage'));
                }
                return;
            }

            /**
             * @commandpath playlist importpl file [playlist name] [file] - Creates/overwrites playlist with new list generated from ./addons/youtubePlayer/file. File may contain links, descriptions, or YouTube IDs
             */
            if (action.equalsIgnoreCase('importpl')) {
                if (actionArgs.length == 3) {
                    if (actionArgs[0].equalsIgnoreCase('file')) {
                        var importPlaylist = new BotPlayList(actionArgs[1], false);
                        $.say($.whisperPrefix(sender) + importPlaylist.importPlaylistFile(actionArgs[1], actionArgs[2]));
                        return;
                    }
                }
                $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.importpl.file.usage'));
            }
            return;
        }

        // Skip all following commands, since they all need the client to be connected
        // (a.k.a. they need a current song to be active)
        if (connectedPlayerClient == null) {
            $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.client.404'));
            return;
        }

        /**
         * @commandpath stealsong [playlist name] - Add the currently playing song to the current playlist or a given playlist
         */
        if (command.equalsIgnoreCase('stealsong')) {
            if (args.length == 0) {
                currentPlaylist.addToPlaylist(currentPlaylist.getCurrentVideo());

                $.say($.lang.get(
                    'ytplayer.command.stealsong.this.success',
                    $.username.resolve(sender)
                ));
            } else if ($.inidb.FileExists(playlistDbPrefix + args[0].toLowerCase())) {
                currentPlaylist.addToPlaylist(currentPlaylist.getCurrentVideo(), args[0].toLowerCase());

                $.say($.lang.get(
                    'ytplayer.command.stealsong.other.success',
                    $.username.resolve(sender),
                    args[0]
                ));
            } else {
                $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.playlist.404', args[0]));
            }
        }

        /**
         * @commandpath jumptosong [position in playlist] - Jump to a song in the current playlist by position in playlist.
         */
        if (command.equalsIgnoreCase('jumptosong')) {
            if (!currentPlaylist.jumpToSong(args[0])) {
                $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.jumptosong.failed', args[0]));
            }
        }

        /**
         * @commandpath skipsong - Skip the current song and proceed to the next video in line
         */
        if (command.equalsIgnoreCase('skipsong')) {
            currentPlaylist.nextVideo();
            connectedPlayerClient.pushSongList();
        }

        /**
         * @commandpath songrequest [YouTube ID | YouTube link | search string] - Request a song!
         */
        if (command.equalsIgnoreCase('songrequest')) {
            if (args.length == 0) {
                $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.songrequest.usage'));
                return;
            }
            var request = currentPlaylist.requestSong(event.getArguments(), sender);
            if (request != null) {
                $.say($.lang.get(
                    'ytplayer.command.songrequest.success',
                    $.resolveRank(sender),
                    request.getVideoTitle(),
                    currentPlaylist.getRequestsCount(),
                    request.getVideoId()
                ));
                connectedPlayerClient.pushSongList();
            } else {
                $.say($.whisperPrefix(sender) + $.lang.get(
                    'ytplayer.command.songrequest.failed', currentPlaylist.getRequestFailReason()
                ));
            }
        }

        /**
         * @commandpath wrongsong - Removes the last requested song from the user
         * @commandpath wrongsong user [username] - Removes the last requested song from a specific user
         */
        if (command.equalsIgnoreCase('wrongsong')) {
            if (args.length == 0) {
                var songTitle = currentPlaylist.removeUserSong(sender);
                if (songTitle) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.wrongsong.success', songTitle));
                    connectedPlayerClient.pushSongList();
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.wrongsong.404'));
                }
            } else {
                if (args[0].equalsIgnoreCase('user')) {
                    if (args[1]) {
                        var songTitle = currentPlaylist.removeUserSong(args[1].toLowerCase());
                        if (songTitle) {
                            $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.wrongsong.user.success', args[1], songTitle));
                            connectedPlayerClient.pushSongList();
                        } else {
                            $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.wrongsong.404'));
                        }
                    }
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.wrongsong.usage'));
                }
            }
        }

        /**
         * @commandpath previoussong - Announce the previous played song in the chat
         */
        if (command.equalsIgnoreCase('previoussong')) {
            if (currentPlaylist.getPreviousVideo()) {
                $.say($.lang.get(
                    'ytplayer.command.previoussong',
                    currentPlaylist.getPreviousVideo().getVideoTitle(),
                    currentPlaylist.getPreviousVideo().getOwner(),
                    currentPlaylist.getPreviousVideo().getVideoLink()
                ));
            } else {
                $.say($.lang.get('ytplayer.command.previoussong.404'));
            }
        }

        /**
         * @commandpath currentsong - Announce the currently playing song in the chat
         */
        if (command.equalsIgnoreCase('currentsong')) {
            $.say($.lang.get(
                'ytplayer.command.currentsong',
                currentPlaylist.getCurrentVideo().getVideoTitle(),
                currentPlaylist.getCurrentVideo().getOwner(),
                currentPlaylist.getCurrentVideo().getVideoLink()
            ));
        }

        /**
         * @commandpath nextsong - Display the next song in the request queue
         * @commandpath nextsong [index number] - Display the full song title at the index.
         * @commandpath nextsong next [n] - Display the next n songs in queue, max of 5
         * @commandpath nextsong list [x-y] - Display songs in queue from the range, max of 5
         */
        if (command.equalsIgnoreCase('nextsong')) {
            var minRange,
                maxRange;

            if (!args[0]) {
                if (currentPlaylist.getRequestAtIndex(1) == null) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.404'));
                    return;
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.single', currentPlaylist.getRequestAtIndex(1).getVideoTitle()));
                    return;
                }
            } else {
                if (!isNaN(args[0])) {
                   if (currentPlaylist.getRequestAtIndex(parseInt(args[0])) == null) {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.404'));
                        return;
                    } else {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.single', '#' + args[0] + ': ' + currentPlaylist.getRequestAtIndex(parseInt(args[0])).getVideoTitle()));
                        return;
                    }
                } else if (args[0].equalsIgnoreCase('next')) {
                    if (!args[1]) {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.usage'));
                        return;
                    }
                    if (isNaN(args[1])) {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.usage'));
                        return;
                    }
                    minRange = 1;
                    maxRange = parseInt(args[1]);
                } else if (args[0].equalsIgnoreCase('list')) {
                    if (!args[1]) {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.usage'));
                        return;
                    }
                    if (args[1].match(/\d+\-\d+/)) {
                        minRange = parseInt(args[1].match(/(\d)+\-\d+/)[1]);
                        maxRange = parseInt(args[1].match(/\d+\-(\d+)/)[1]);
                        if (maxRange - minRange > 5) {
                            maxRange = minRange + 5;
                        }
                    } else {
                        $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.usage'));
                        return;
                    }
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.usage'));
                    return;
                }

                var displayString = '';
                while (minRange <= maxRange) {
                    if (currentPlaylist.getRequestAtIndex(minRange) == null) {
                        break;
                    }
                    displayString += "[(#"+ minRange + ") "+ currentPlaylist.getRequestAtIndex(minRange).getVideoTitle().substr(0, 20) + "] ";
                    minRange++;
                }
                if (displayString.equals('')) {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.range.404'));
                } else {
                    $.say($.whisperPrefix(sender) + $.lang.get('ytplayer.command.nextsong.range', displayString));
                }
            }
        }
    });

    $.bind('initReady', function() {
        if ($.bot.isModuleEnabled('./systems/ytPlayer.js')) {
            $.registerChatCommand('./systems/ytPlayer.js', 'ytp', 1);
            $.registerChatCommand('./systems/ytPlayer.js', 'playlist', 1);
            $.registerChatCommand('./systems/ytPlayer.js', 'stealsong', 1);
            $.registerChatCommand('./systems/ytPlayer.js', 'jumptosong', 1);
            $.registerChatCommand('./systems/ytPlayer.js', 'skipsong', 1);
            $.registerChatCommand('./systems/ytPlayer.js', 'songrequest');
            $.registerChatCommand('./systems/ytPlayer.js', 'previoussong');
            $.registerChatCommand('./systems/ytPlayer.js', 'currentsong');
            $.registerChatCommand('./systems/ytPlayer.js', 'wrongsong');
            $.registerChatCommand('./systems/ytPlayer.js', 'nextsong');
            $.registerChatSubcommand('wrongsong', 'user', 2);

            /** Pre-load last activated playlist */
            currentPlaylist = new BotPlayList(activePlaylistname, true);

            /** if the current playlist is "default" and it's empty, add some default songs. */
            if (currentPlaylist.getPlaylistname().equals('default') && currentPlaylist.getplaylistLength() == 0) {
                /** CyberPosix - Under The Influence (Outertone Free Release) */
                try {
                    currentPlaylist.addToPlaylist(new YoutubeVideo('gotxnim9h8w', $.botName));
                } catch (ex) {
                    $.logError("ytPlayer.js", 839, "YoutubeVideo::exception: " + ex);
                }

                /** Different Heaven & Eh!de - My Heart (Outertone 001 - Zero Release) */
                try {
                    currentPlaylist.addToPlaylist(new YoutubeVideo('WFqO9DoZZjA', $.botName));
                } catch (ex) {
                    $.logError("ytPlayer.js", 846, "YoutubeVideo::exception: " + ex);
                }


                /** Tobu - Higher (Outertone Release) */
                try {
                    var youtubeVideo = new YoutubeVideo('l7C29RM1UmU', $.botName);
                    currentPlaylist.addToPlaylist(new YoutubeVideo('l7C29RM1UmU', $.botName))
                } catch (ex) {
                    $.logError("ytPlayer.js", 855, "YoutubeVideo::exception: " + ex);
                }
            }
        }
    });
})();
