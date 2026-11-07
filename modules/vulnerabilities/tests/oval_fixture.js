// A small CVE file of Ubuntu's, laid out as Canonical writes it (one element a line, the
// sections in order), with one CVE of each shape the module reads:
//
//     CVE-2026-0001  critical, php8.3 fixed in 8.3.6-0ubuntu0.24.04.13
//     CVE-2026-0002  critical, libfoo1 with no fix yet
//     CVE-2026-0003  critical, the kernel with no fix yet (linux and linux-riscv share it)
//     CVE-2026-0004  critical, the kernel fixed in 6.8.0-149
//     CVE-2026-0005  critical, gstreamer fixed only in Ubuntu Pro
//     CVE-2026-0006  high, openssl: not kept
//     CVE-2026-0007  critical, a test of a kind not known: not kept
function oval_fixture()
{
    return [
        '<?xml version="1.0" ?>',
        '<oval_definitions xmlns="http://oval.mitre.org/XMLSchema/oval-definitions-5">',
        '  <generator>',
        '    <oval:timestamp>2026-11-06T11:09:56</oval:timestamp>',
        '  </generator>',
        '  <definitions>',
        '    <definition id="oval:com.ubuntu.noble:def:100" class="inventory" version="1">',
        '      <metadata>',
        '        <title>Check that Ubuntu 24.04 LTS (noble) is installed.</title>',
        '        <description />',
        '      </metadata>',
        '      <criteria>',
        '        <criterion test_ref="oval:com.ubuntu.noble:tst:100" comment="The host is part of the unix family." />',
        '      </criteria>',
        '    </definition>',
        definition('0001', 'critical', '9.2', '20261021', 'PHP frees request memory early &amp;amp; reads it after.', [
            '        <criteria operator="OR">',
            criterion('10', 'php8.3 source package in noble, is affected and has been fixed (note: \'8.3.6-0ubuntu0.24.04.13\').'),
            '        </criteria>',
        ]),
        definition('0002', 'critical', '9.8', '20261101', 'libfoo reads past its buffer.', [
            '        <criteria operator="OR">',
            criterion('20', 'foo source package in noble, is affected and needs fixing.'),
            '        </criteria>',
        ]),
        definition('0003', 'critical', '9.2', '20261015', 'The kernel frees inet_opt early: ireq-&amp;gt;ireq_opt.', [
            '        <criteria operator="OR">',
            criterion('30', 'Is kernel \'linux\' running?'),
            criterion('31', 'Is kernel \'linux-riscv\' running?'),
            '        </criteria>',
        ]),
        definition('0004', 'critical', '9.0', '20260911', 'svcrdma takes inline data it should not.', [
            '        <criteria operator="OR">',
            '          <criteria operator="AND">',
            criterion('30', 'Is kernel \'linux\' running?'),
            criterion('40', '\'linux\' kernel in noble was vulnerable but has been fixed (note: \'6.8.0-149.149\').'),
            '          </criteria>',
            '        </criteria>',
        ]),
        definition('0005', 'critical', null, '20250601', 'gstreamer plays a bad file.', [
            '        <criteria operator="OR">',
            criterion('50', 'gst-plugins-bad1.0 source package in noble, is affected and has been fixed (note: \'1.24.2-1ubuntu4+esm1\').'),
            '        </criteria>',
        ]),
        definition('0006', 'high', '7.5', '20261102', 'openssl is slow on a large key.', [
            '        <criteria operator="OR">',
            criterion('60', 'openssl source package in noble, is affected and needs fixing.'),
            '        </criteria>',
        ]),
        definition('0007', 'critical', '9.9', '20261103', 'Asked by a test of a kind not known.', [
            '        <criteria operator="OR">',
            criterion('70', 'Something else entirely.'),
            '        </criteria>',
        ]),
        '  </definitions>',
        '  <tests>',
        '    <ind-def:family_test id="oval:com.ubuntu.noble:tst:100" version="1" check="at least one" comment="Is the host part of the unix family?">',
        '      <ind-def:object object_ref="oval:com.ubuntu.noble:obj:100" />',
        '      <ind-def:state state_ref="oval:com.ubuntu.noble:ste:100" />',
        '    </ind-def:family_test>',
        dpkg_test('10', '10', '10'),
        dpkg_test('20', '20', null),
        uname_test('30', '30'),
        uname_test('31', '31'),
        '    <ind-def:variable_test id="oval:com.ubuntu.noble:tst:40" version="1" check="all" check_existence="all_exist" comment="kernel \'linux\' version comparison">',
        '      <ind-def:object object_ref="oval:com.ubuntu.noble:obj:210" />',
        '      <ind-def:state state_ref="oval:com.ubuntu.noble:ste:40" />',
        '    </ind-def:variable_test>',
        dpkg_test('50', '50', '50'),
        dpkg_test('60', '60', null),
        '    <ind-def:textfilecontent54_test id="oval:com.ubuntu.noble:tst:70" version="1" check="all" comment="Something else">',
        '      <ind-def:object object_ref="oval:com.ubuntu.noble:obj:70" />',
        '    </ind-def:textfilecontent54_test>',
        '  </tests>',
        '  <objects>',
        '    <unix-def:uname_object id="oval:com.ubuntu.noble:obj:200" version="1" />',
        '    <ind-def:variable_object id="oval:com.ubuntu.noble:obj:210" version="1">',
        '      <ind-def:var_ref>oval:com.ubuntu.noble:var:200</ind-def:var_ref>',
        '    </ind-def:variable_object>',
        dpkg_object('10'),
        dpkg_object('20'),
        dpkg_object('50'),
        dpkg_object('60'),
        '  </objects>',
        '  <states>',
        dpkg_state('10', '8.3.6-0ubuntu0.24.04.13'),
        '    <unix-def:uname_state id="oval:com.ubuntu.noble:ste:30" version="1">',
        '      <unix-def:os_release operation="pattern match">6\\.8\\.0\\-\\d+(\\-generic|\\-generic\\-64k)</unix-def:os_release>',
        '    </unix-def:uname_state>',
        '    <unix-def:uname_state id="oval:com.ubuntu.noble:ste:31" version="1">',
        '      <unix-def:os_release operation="pattern match">6\\.8\\.0\\-\\d+(\\-generic)</unix-def:os_release>',
        '    </unix-def:uname_state>',
        '    <ind-def:variable_state id="oval:com.ubuntu.noble:ste:40" version="1" comment="\'linux\' kernel version">',
        '      <ind-def:value datatype="debian_evr_string" operation="less than">0:6.8.0-149</ind-def:value>',
        '    </ind-def:variable_state>',
        dpkg_state('50', '1.24.2-1ubuntu4+esm1'),
        '  </states>',
        '  <variables>',
        variable('10', ['php8.3', 'php8.3-cli', 'php8.3-common']),
        variable('20', ['libfoo1', 'foo-tools']),
        variable('50', ['gstreamer1.0-plugins-bad']),
        variable('60', ['openssl', 'libssl3t64']),
        '    <local_variable id="oval:com.ubuntu.noble:var:200" version="1" datatype="debian_evr_string" comment="kernel version in evr format">',
        '      <concat>',
        '        <literal_component>0:</literal_component>',
        '      </concat>',
        '    </local_variable>',
        '  </variables>',
        '</oval_definitions>',
        '',
    ].flat().join('\n');
}

function definition(n, priority, score, published, description, criteria)
{
    const scored = (score === null) ? '' : ` cvss_score="${score}"`;
    return [
        `    <definition id="oval:com.ubuntu.noble:def:${n}" class="vulnerability" version="1">`,
        '      <metadata>',
        `        <title>CVE-2026-${n} on Ubuntu 24.04 LTS (noble) - ${priority}</title>`,
        `        <description>${description}</description>`,
        '        <advisory from="security@ubuntu.com">',
        `          <cve href="https://ubuntu.com/security/CVE-2026-${n}" priority="${priority}" public="${published}"${scored}>CVE-2026-${n}</cve>`,
        '        </advisory>',
        '      </metadata>',
        '      <criteria>',
        '        <extend_definition definition_ref="oval:com.ubuntu.noble:def:100" comment="Ubuntu 24.04 LTS (noble) is installed" />',
        ...criteria,
        '      </criteria>',
        '    </definition>',
    ];
}

function criterion(n, comment)
{
    return `          <criterion test_ref="oval:com.ubuntu.noble:tst:${n}" comment="${comment}" />`;
}

function dpkg_test(n, object, state)
{
    return [
        `    <linux-def:dpkginfo_test id="oval:com.ubuntu.noble:tst:${n}" version="1" check="at least one" comment="Does the package exist?">`,
        `      <linux-def:object object_ref="oval:com.ubuntu.noble:obj:${object}" />`,
        ...((state === null) ? [] : [`      <linux-def:state state_ref="oval:com.ubuntu.noble:ste:${state}" />`]),
        '    </linux-def:dpkginfo_test>',
    ];
}

function uname_test(n, state)
{
    return [
        `    <unix-def:uname_test id="oval:com.ubuntu.noble:tst:${n}" version="1" check="at least one" comment="Is kernel running?">`,
        '      <unix-def:object object_ref="oval:com.ubuntu.noble:obj:200" />',
        `      <unix-def:state state_ref="oval:com.ubuntu.noble:ste:${state}" />`,
        '    </unix-def:uname_test>',
    ];
}

function dpkg_object(n)
{
    return [
        `    <linux-def:dpkginfo_object id="oval:com.ubuntu.noble:obj:${n}" version="1" comment="The package binaries">`,
        `      <linux-def:name var_ref="oval:com.ubuntu.noble:var:${n}" var_check="at least one" />`,
        '    </linux-def:dpkginfo_object>',
    ];
}

function dpkg_state(n, version)
{
    return [
        `    <linux-def:dpkginfo_state id="oval:com.ubuntu.noble:ste:${n}" version="1" comment="The binary package version is less than '${version}'">`,
        `      <linux-def:evr datatype="debian_evr_string" operation="less than">${version}</linux-def:evr>`,
        '    </linux-def:dpkginfo_state>',
    ];
}

function variable(n, names)
{
    return [
        `    <constant_variable id="oval:com.ubuntu.noble:var:${n}" version="1" datatype="string" comment="The package binaries">`,
        ...names.map(v => `      <value>${v}</value>`),
        '    </constant_variable>',
    ];
}

module.exports = oval_fixture;
