'use strict';
const path=require('node:path');
const {inspect}=require('./package_operations');
try{const [bundle,root,source]=process.argv.slice(2);const info=inspect(bundle,root);require(path.join(info.bundle,'payload/bridge/observation_lease')).recover(source);console.log('dead_observer_lease_released; no DB opened');}catch{console.error('lease_recovery_rejected');process.exitCode=1;}
