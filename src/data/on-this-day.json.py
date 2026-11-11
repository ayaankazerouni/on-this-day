from datetime import date
import json

from events import get_events_on_day

today = date.today()
day = today.day
month = today.month

_, onthisday = get_events_on_day(month=month, day=day)

print(json.dumps(onthisday))