const UUID = 'serviceman@vbarbarosh.com';
const BUS_NAME = 'com.serviceman.Capture';
const OBJECT_PATH = '/com/serviceman/Capture';

// The one thing on a gnome machine that may take a picture of the screen: code inside gnome
// shell itself. Everything outside it — gnome-screenshot, a dbus call, a wayland grabber — is
// either refused, blind, or a window waiting for somebody to click it. This is that code: a
// shell extension exposing one method on the session bus, which the agent then calls.
//
// It is written here rather than kept as files, for the same reason the installer is: it
// belongs to the version of serviceman that serves it, and a machine gets it over the link.
function agent_gnome_helper()
{
    return {
        uuid: UUID,
        bus_name: BUS_NAME,
        object_path: OBJECT_PATH,
        files: {
            'metadata.json': metadata_json(),
            'extension.js': extension_js(),
        },
    };
}

function metadata_json()
{
    return `${JSON.stringify({
        uuid: UUID,
        name: 'serviceman capture',
        description: 'Answers com.serviceman.Capture.Take(path) with a picture of this screen, for the serviceman agent on this machine.',
        // Every shell that speaks the modern extension api. A shell newer than this list runs
        // it anyway when version validation is off, which the installer turns off for this one.
        'shell-version': ['45', '46', '47', '48', '49', '50', '51'],
        'session-modes': ['user', 'unlock-dialog'],
    }, null, 4)}\n`;
}

// GNOME 45 and later load extensions as modules and want a class with enable and disable.
// The capture itself is Shell.Screenshot, which is what the shell's own screenshot window
// uses — inside the shell there is nobody to refuse it.
function extension_js()
{
    return `import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = \`<node>
  <interface name="${BUS_NAME}">
    <method name="Take">
      <arg type="s" direction="in" name="path"/>
      <arg type="b" direction="out" name="ok"/>
      <arg type="s" direction="out" name="said"/>
    </method>
  </interface>
</node>\`;

export default class ServicemanCapture extends Extension
{
    enable()
    {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '${OBJECT_PATH}');
        this._owned = Gio.bus_own_name(Gio.BusType.SESSION, '${BUS_NAME}', Gio.BusNameOwnerFlags.NONE, null, null, null);
    }

    disable()
    {
        if (this._owned) {
            Gio.bus_unown_name(this._owned);
            this._owned = null;
        }
        if (this._dbus) {
            this._dbus.unexport();
            this._dbus = null;
        }
    }

    // The answer goes back when the picture is written, so whoever asked can read the file the
    // moment it is told the picture is there
    TakeAsync([path], invocation)
    {
        try {
            const file = Gio.File.new_for_path(path);
            const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            const shooter = new Shell.Screenshot();
            shooter.screenshot(false, stream, (source, answer) => {
                try {
                    source.screenshot_finish(answer);
                    stream.close(null);
                    invocation.return_value(new GLib.Variant('(bs)', [true, path]));
                }
                catch (error) {
                    invocation.return_value(new GLib.Variant('(bs)', [false, String(error)]));
                }
            });
        }
        catch (error) {
            invocation.return_value(new GLib.Variant('(bs)', [false, String(error)]));
        }
    }
}
`;
}

module.exports = agent_gnome_helper;
