import { useEffect } from "react";
import { readMeetLowData, subscribeMeetLowData } from "@/meet-core/src/meet-low-data";
import type { MeetEncodingPrefs } from "@/meet-core/src/meet-send-encoding";

type EncodingClient = {
  setEncodingPrefs: (prefs: Partial<MeetEncodingPrefs>) => void;
};

/** Keep the live senders on the device's low-data flag without a new offer. */
export function useMeetSendEncoding(client: EncodingClient): void {
  useEffect(() => {
    const apply = () => {
      client.setEncodingPrefs({ lowData: readMeetLowData() });
    };
    apply();
    return subscribeMeetLowData(apply);
  }, [client]);
}
