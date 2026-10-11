# Logs

A log could be thought of as one infinite file where each line has the following form

2026/08/15 00:48:05 [group_uid][sender] Optional description

Each line is a pure text.

group_uid
    It his two goals
    1) to group logs so you would know they are come from single source
    2) to link to parent; each time when a new group_uid produced a new log entry is created with parent group_uid

    2026/08/15 00:51:06 [group_uid2][spawn] parent=group_uid1

    Kind of a stack; That way you could trace log to its source.
        

sender
    Uniquely identifies sender in code; all senders are unique; sender - place
    in code where such "word/tag" is emited.
    cronjob_clean_begin
    cronjob_clean_tick
    cronjob_clean_end_ok
    cronjob_clean_end_error
    export_html5_begin
    export_html5_progress
    export_html5_end_ok
