ALTER TABLE `devices` ADD `battery_low` integer;--> statement-breakpoint
-- carry the flag over from open battery issues, so the restart that applies this doesn't resolve them
UPDATE `devices` SET `battery_low` = 1 WHERE `ieee` IN (SELECT `ieee` FROM `issues` WHERE `rule` = 'battery.low' AND `state` != 'resolved' AND json_extract(`evidence`, '$.batteryLow') = 1);
