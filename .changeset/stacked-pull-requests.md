---
"forge": minor
---

The Ticket playbook of the `engineering` skill starts a ticket whose open blockers all have open pull requests on the branch of the top one, so its pull request becomes the next layer of a stacked pull request. The `pull-request` skill keeps a pull request on its base, links a layer into its stack with the `gh stack` extension, and rebases the layers above after a push to a lower one.
