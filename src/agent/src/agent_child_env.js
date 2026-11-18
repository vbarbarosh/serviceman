// The env of what the agent starts for a service or a person: a program, a line of its life, a
// shell, a kept terminal. It is the agent's own but its token, the machine's key to serviceman,
// which nothing started here has any use for and which a page that prints its env (phpinfo(),
// a debug page, an error report) would hand to whoever looks; then what is given on top, where
// a service may name a SERVICEMAN_TOKEN of its own.
//
//     ...given  objects of names and values, laid over it in order
function agent_child_env(...given)
{
    const env = Object.assign({}, process.env);
    delete env.SERVICEMAN_TOKEN;
    return Object.assign(env, ...given);
}

module.exports = agent_child_env;
